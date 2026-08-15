import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestPlan,
  TestPlanRevision,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { contentHash } from '../../common/hash';
import { deriveArtefactState } from '../../common/state-machines';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
import { EngineClient } from '../../engine/engine.client';
import { LlmRuntimeService } from '../../common/llm/llm-runtime.service';
import { ApprovalDecision } from '../../common/enums';
import { GenerateTestPlanDto, UpdateTestPlanDto } from './dto/test-plan.dto';

/** Section-level revision comparison entry (FR-V3-TP-003). */
export interface RevisionSectionDiff {
  section: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  from: unknown;
  to: unknown;
}

@Injectable()
export class TestPlansService {
  constructor(
    @InjectRepository(TestPlan) private readonly plans: Repository<TestPlan>,
    @InjectRepository(TestPlanRevision)
    private readonly revisions: Repository<TestPlanRevision>,
    @InjectRepository(Requirement)
    private readonly requirements: Repository<Requirement>,
    @InjectRepository(Analysis) private readonly analyses: Repository<Analysis>,
    @InjectRepository(GenerationRun)
    private readonly runs: Repository<GenerationRun>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    private readonly derivation: RequirementDerivationService,
    private readonly engine: EngineClient,
    private readonly llm: LlmRuntimeService,
  ) {
    // Retry recreates the generation from the stored inputRefs (FR-V3-LOG-009).
    this.jobs.registerRetryHandler('test_plan', (original, user, correlationId) =>
      this.generate(
        original.projectId,
        {
          requirementIds:
            (original.inputRefs?.requirementIds as string[]) ?? undefined,
        },
        user,
        correlationId,
      ),
    );
  }

  async generate(
    projectId: string,
    dto: GenerateTestPlanDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    // Include requirements derived from uploaded documents (FR-IN-008), so
    // the plan covers documents even when no manual requirements exist.
    const requirements = await this.derivation.resolveGenerationScope(
      projectId,
      dto.requirementIds,
      undefined,
      user,
      correlationId,
    );
    const analyses = await this.analyses.find({ where: { projectId } });

    const job = await this.jobs.create({
      projectId,
      type: 'test_plan',
      correlationId,
      idempotencyKey,
      inputRefs: { requirementIds: requirements.map((r) => r.id) },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'test_plan.generate',
      resourceType: 'job',
      resourceId: job.id,
      projectId,
      correlationId,
    });

    this.jobs.dispatch(job, async (j, ctx) => {
      const llm = await this.llm.engineLlmFor(projectId);
      const llmLabel =
        llm.type === 'cloud'
          ? `${llm.provider}:${llm.model}`
          : llm.model || 'the default model';
      await ctx.log({
        stage: 'requirement mapping',
        message: `Mapping ${requirements.length} requirement(s) and ${analyses.length} analysis result(s) into the plan scope`,
        progress: 10,
      });
      await ctx.checkpoint();

      await ctx.log({
        stage: 'scope generation',
        message: `Generating plan sections with ${llmLabel} (objectives, scope, environments, entry/exit criteria)`,
        progress: 25,
      });
      const output = await this.engine.testPlan(
        {
          projectName: project.name,
          baseUrl: project.baseUrl,
          requirements: requirements.map((r) => ({
            id: r.id,
            title: r.title,
            text: r.text,
            acceptance_criteria: r.acceptanceCriteria ?? [],
          })),
          analyses: analyses.map((a) => a.output),
          model: llm.type === 'local' ? llm.model : undefined,
          temperature: project.llmTemperature,
          llm,
        },
        correlationId,
        idempotencyKey,
      );
      await ctx.log({
        stage: 'risk analysis',
        message: 'Plan sections returned; validating structure and risk coverage',
        progress: 75,
      });
      await ctx.checkpoint();

      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'test_plan',
          jobId: job.id,
          model: llm.model ?? '',
          temperature: project.llmTemperature,
          contentHash: contentHash(output),
          status: 'completed',
        }),
      );

      await ctx.log({
        stage: 'persistence',
        message: 'Saving the test plan and opening revision v1',
        progress: 90,
      });
      const plan = await this.plans.save(
        this.plans.create({
          projectId,
          generationRunId: run.id,
          title: dto.title || `${project.name} Test Plan`,
          version: 1,
          approvalStatus: 'pending',
          schemaVersion: (output.schema_version as string) || 'v1',
          contentHash: contentHash(output),
          sections: output,
          model: llm.model ?? '',
          createdBy: user.id,
        }),
      );

      // Revision history starts at v1 (FR-V3-TP-001).
      await this.saveRevision(plan, user, 'generated', 'Initial generated plan');

      return {
        resultRefs: { testPlanId: plan.id, generationRunId: run.id },
        readyEvent: {
          type: 'plan.ready' as const,
          payload: { testPlanId: plan.id },
        },
      };
    });

    return { jobId: job.id, status: job.status };
  }

  /** Append the next v{int} revision snapshot (FR-V3-TP-001/002). */
  private async saveRevision(
    plan: TestPlan,
    user: AuthUser | null,
    sourceAction: string,
    changeSummary: string,
  ): Promise<TestPlanRevision> {
    const last = await this.revisions.findOne({
      where: { testPlanId: plan.id },
      order: { version: 'DESC' },
    });
    const version = (last?.version ?? 0) + 1;
    plan.version = version;
    await this.plans.save(plan);
    return this.revisions.save(
      this.revisions.create({
        testPlanId: plan.id,
        projectId: plan.projectId,
        version,
        title: plan.title,
        sections: plan.sections,
        contentHash: plan.contentHash,
        sourceAction,
        changeSummary,
        approvalStatus: plan.approvalStatus,
        author: user?.email ?? 'system',
        authorId: user?.id ?? null,
      }),
    );
  }

  async listByProject(projectId: string, user: AuthUser) {
    await this.membership.ensureMember(projectId, user);
    const plans = await this.plans.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    return plans.map((p) => this.withState(p));
  }

  async getOne(id: string, user: AuthUser): Promise<TestPlan> {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundAppException(`Test plan ${id} not found`);
    await this.membership.ensureMember(plan.projectId, user);
    return this.withState(plan);
  }

  /** Attach the §23.7 artefact lifecycle state without a data migration. */
  private withState(plan: TestPlan): TestPlan & { artefactState: string } {
    return Object.assign(plan, {
      artefactState: deriveArtefactState(plan),
    });
  }

  async update(
    id: string,
    dto: UpdateTestPlanDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<TestPlan> {
    const plan = await this.getOne(id, user);
    const changed: string[] = [];
    if (dto.title !== undefined && dto.title !== plan.title) {
      plan.title = dto.title;
      changed.push('title');
    }
    if (dto.sections) {
      changed.push(...Object.keys(dto.sections));
      plan.sections = { ...(plan.sections || {}), ...dto.sections };
    }
    plan.contentHash = contentHash(plan.sections);

    // Every saved edit becomes the next v{int} revision (FR-V3-TP-001).
    await this.saveRevision(
      plan,
      user,
      'edited',
      dto.changeSummary || `Edited: ${changed.join(', ') || 'no-op'}`,
    );

    // Editing an approved plan resets its approval (FR-VAL-007).
    await this.approvals.onUpstreamModified(
      'test_plan',
      id,
      user,
      correlationId,
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'test_plan.update',
      resourceType: 'test_plan',
      resourceId: id,
      projectId: plan.projectId,
      correlationId,
      metadata: { version: plan.version, changed },
    });
    return this.getOne(id, user);
  }

  async approve(
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const plan = await this.getOne(id, user);
    const result = await this.approvals.decide(
      'test_plan',
      id,
      decision,
      comment,
      user,
      correlationId,
    );
    // Mirror the decision onto the latest revision's metadata (FR-V3-TP-002).
    const latest = await this.revisions.findOne({
      where: { testPlanId: plan.id },
      order: { version: 'DESC' },
    });
    if (latest) {
      latest.approvalStatus =
        decision === 'approved'
          ? 'approved'
          : decision === 'rejected'
            ? 'rejected'
            : 'pending';
      await this.revisions.save(latest);
    }
    return result;
  }

  // --- revision history (FR-V3-TP-001/002/003) -----------------------------

  async listRevisions(id: string, user: AuthUser): Promise<TestPlanRevision[]> {
    await this.getOne(id, user);
    return this.revisions.find({
      where: { testPlanId: id },
      order: { version: 'DESC' },
    });
  }

  async getRevision(
    id: string,
    version: number,
    user: AuthUser,
  ): Promise<TestPlanRevision> {
    await this.getOne(id, user);
    const rev = await this.revisions.findOne({
      where: { testPlanId: id, version },
    });
    if (!rev) {
      throw new NotFoundAppException(`Revision v${version} of plan ${id} not found`);
    }
    return rev;
  }

  /** Side-by-side comparison of two revisions (FR-V3-TP-003). */
  async compareRevisions(
    id: string,
    fromVersion: number,
    toVersion: number,
    user: AuthUser,
  ): Promise<{
    from: TestPlanRevision;
    to: TestPlanRevision;
    sections: RevisionSectionDiff[];
  }> {
    const [from, to] = await Promise.all([
      this.getRevision(id, fromVersion, user),
      this.getRevision(id, toVersion, user),
    ]);
    const keys = new Set([
      ...Object.keys(from.sections || {}),
      ...Object.keys(to.sections || {}),
    ]);
    keys.delete('schema_version');
    const sections: RevisionSectionDiff[] = [...keys].sort().map((section) => {
      const a = (from.sections || {})[section];
      const b = (to.sections || {})[section];
      const change =
        a === undefined
          ? 'added'
          : b === undefined
            ? 'removed'
            : JSON.stringify(a) === JSON.stringify(b)
              ? 'unchanged'
              : 'changed';
      return { section, change, from: a, to: b };
    });
    return { from, to, sections };
  }

  /** Restore an older revision as a new latest revision (FR-V3-TP-003). */
  async restoreRevision(
    id: string,
    version: number,
    user: AuthUser,
    correlationId?: string,
  ): Promise<TestPlan> {
    const plan = await this.getOne(id, user);
    const rev = await this.getRevision(id, version, user);
    plan.sections = rev.sections;
    plan.title = rev.title || plan.title;
    plan.contentHash = contentHash(plan.sections);
    await this.saveRevision(plan, user, 'restored', `Restored from v${version}`);

    await this.approvals.onUpstreamModified('test_plan', id, user, correlationId);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'test_plan.restore_revision',
      resourceType: 'test_plan',
      resourceId: id,
      projectId: plan.projectId,
      correlationId,
      metadata: { restoredFrom: version, newVersion: plan.version },
    });
    return this.getOne(id, user);
  }

  async export(
    id: string,
    format: string,
    user: AuthUser,
  ): Promise<{ contentType: string; filename: string; body: string | Buffer }> {
    const plan = await this.getOne(id, user);
    const base = `test-plan-${plan.id}`;
    if (format === 'json') {
      return {
        contentType: 'application/json',
        filename: `${base}.json`,
        body: JSON.stringify(
          { id: plan.id, title: plan.title, version: plan.version, sections: plan.sections },
          null,
          2,
        ),
      };
    }
    const md = renderTestPlanMarkdown(plan.title, plan.sections);
    if (format === 'pdf') {
      // Real PDF via the engine's headless Chromium (AIQA-REPORT-003 class):
      // if rendering is unavailable, deliver honest Markdown — never text
      // bytes labelled application/pdf.
      try {
        const { pdfBase64 } = await this.engine.renderPdf(
          markdownToPrintableHtml(plan.title, md),
        );
        return {
          contentType: 'application/pdf',
          filename: `${base}.pdf`,
          body: Buffer.from(pdfBase64, 'base64'),
        };
      } catch {
        return { contentType: 'text/markdown', filename: `${base}.md`, body: md };
      }
    }
    // No DOCX renderer in this tier (documented gap): deliver honest
    // Markdown instead of text bytes labelled as a Word document.
    return { contentType: 'text/markdown', filename: `${base}.md`, body: md };
  }
}

/** Minimal print-friendly HTML wrapper for Markdown content (PDF export). */
function markdownToPrintableHtml(title: string, md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 22px; border-bottom: 2px solid #444; padding-bottom: 6px; }
  pre { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.55; }
</style></head><body><h1>${esc(title)}</h1><pre>${esc(md)}</pre></body></html>`;
}

function renderTestPlanMarkdown(
  title: string,
  sections: Record<string, unknown>,
): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const [key, value] of Object.entries(sections || {})) {
    if (key === 'schema_version') continue;
    const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`## ${heading}`);
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`- ${String(item)}`);
    } else if (value && typeof value === 'object') {
      lines.push('```json', JSON.stringify(value, null, 2), '```');
    } else {
      lines.push(String(value ?? ''));
    }
    lines.push('');
  }
  return lines.join('\n');
}
