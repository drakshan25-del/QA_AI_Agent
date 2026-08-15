import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DocumentSegment,
  GeneratedArtifact,
  GenerationRun,
  Project,
  Requirement,
  SourceDocument,
  TestCase,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { contentHash } from '../../common/hash';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { LlmRuntimeService } from '../../common/llm/llm-runtime.service';
import { GenerateAutomationDto } from './dto/automation.dto';

/**
 * Extra pytest markers for a generation request (CI marker algebra): the UI
 * suite runs `-m "ui and generated"` and the regression suite runs
 * `-m regression`, so regression files carry only 'regression' — never 'ui' —
 * to keep them out of the UI suite. The engine auto-adds the 'api' marker for
 * testType 'api'.
 */
export function markersFor(
  testType: 'ui' | 'api',
  regressionSuite: boolean,
): string[] {
  if (regressionSuite) return ['regression'];
  return testType === 'ui' ? ['ui'] : [];
}

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    @InjectRepository(TestCase) private readonly cases: Repository<TestCase>,
    @InjectRepository(GenerationRun)
    private readonly runs: Repository<GenerationRun>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(SourceDocument)
    private readonly documents: Repository<SourceDocument>,
    @InjectRepository(DocumentSegment)
    private readonly segments: Repository<DocumentSegment>,
    @InjectRepository(Requirement)
    private readonly requirements: Repository<Requirement>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    private readonly engine: EngineClient,
    private readonly llm: LlmRuntimeService,
  ) {
    this.jobs.registerRetryHandler('automation', (original, user, correlationId) =>
      this.generate(
        original.projectId,
        {
          testCaseIds: (original.inputRefs?.testCaseIds as string[]) ?? [],
          draftPreview: !!original.inputRefs?.draftPreview,
          testType: (original.inputRefs?.testType as 'ui' | 'api') ?? 'ui',
          regressionSuite: !!original.inputRefs?.regressionSuite,
        },
        user,
        correlationId,
      ),
    );
    this.jobs.registerRetryHandler('validation', (original, user, correlationId) =>
      this.validate(
        (original.inputRefs?.artifactId as string) ?? '',
        user,
        correlationId,
      ),
    );
  }

  /**
   * Authoritative description of the API surface under test, assembled for
   * `testType: 'api'` generation (AIQA-EXEC-002). Endpoints must come from
   * uploaded API documentation — the parsed, included segments of every
   * `api_doc` upload — plus the requirement text the selected test cases
   * trace to; without this the LLM invents plausible-looking routes that 404
   * at execution time. Returns '' when the project has no API docs (the
   * engine prompt then says so explicitly and the caller logs a warning).
   */
  private async buildApiSummary(
    projectId: string,
    cases: TestCase[],
  ): Promise<string> {
    const MAX_SUMMARY_CHARS = 6000;
    const parts: string[] = [];

    const docs = await this.documents.find({
      where: { projectId, category: 'api_doc' },
      order: { createdAt: 'ASC' },
    });
    for (const doc of docs.filter((d) => d.parseStatus !== 'failed')) {
      const segs = await this.segments.find({
        where: { documentId: doc.id, inclusionStatus: 'included' },
        order: { sequence: 'ASC' },
      });
      const text = segs
        .map((s) => s.content)
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) parts.push(`# API documentation: ${doc.filename}\n${text}`);
    }

    const reqIds = [...new Set(cases.flatMap((c) => c.requirementIds ?? []))];
    if (reqIds.length) {
      const reqs = await this.requirements.find({ where: { id: In(reqIds) } });
      const text = reqs
        .map((r) => `${r.title ? r.title + ': ' : ''}${r.text}`.trim())
        .filter(Boolean)
        .join('\n');
      if (text) parts.push(`# Requirements under test\n${text}`);
    }

    return parts.join('\n\n').slice(0, MAX_SUMMARY_CHARS);
  }

  async generate(
    projectId: string,
    dto: GenerateAutomationDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const cases = await this.cases.find({
      where: { projectId, id: In(dto.testCaseIds) },
    });
    if (!cases.length) {
      throw new NotFoundAppException('No matching test cases found');
    }

    // Gate: approved cases only, unless a draft preview (FR-TC-009).
    if (!dto.draftPreview) {
      const unapproved = cases.filter((c) => c.approvalStatus !== 'approved');
      if (unapproved.length) {
        throw new ConflictAppException(
          `Cannot generate automation: ${unapproved.length} of ${cases.length} ` +
            `test cases are not approved. Approve them or pass draftPreview=true.`,
          'approval_required',
          { unapprovedTestCaseIds: unapproved.map((c) => c.id) },
        );
      }
    }

    const testType = dto.testType ?? 'ui';
    const regressionSuite = !!dto.regressionSuite;
    const extraMarkers = markersFor(testType, regressionSuite);

    const job = await this.jobs.create({
      projectId,
      type: 'automation',
      correlationId,
      idempotencyKey,
      inputRefs: {
        testCaseIds: dto.testCaseIds,
        draftPreview: !!dto.draftPreview,
        testType,
        regressionSuite,
      },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.generate',
      resourceType: 'job',
      resourceId: job.id,
      projectId,
      correlationId,
      metadata: {
        testCases: cases.length,
        draftPreview: !!dto.draftPreview,
        testType,
        regressionSuite,
      },
    });

    this.jobs.dispatch(job, async (j, ctx) => {
      const llm = await this.llm.engineLlmFor(projectId);
      const llmLabel =
        llm.type === 'cloud'
          ? `${llm.provider}:${llm.model}`
          : llm.model || 'the default model';
      await ctx.log({
        stage: 'framework selection',
        message: `Generating ${project.runner} Playwright automation for ${cases.length} approved test case(s)`,
        progress: 10,
      });
      await ctx.checkpoint();
      await ctx.log({
        stage: 'file generation',
        message: `Creating page objects, locators and assertions with ${llmLabel}`,
        progress: 25,
      });

      // API generation is grounded in the uploaded API documentation and runs
      // against the API base URL, not the UI one (AIQA-EXEC-002): without
      // both, generated requests 404 against invented routes or the wrong host.
      let apiSummary = '';
      if (testType === 'api') {
        apiSummary = await this.buildApiSummary(projectId, cases);
        if (!apiSummary.includes('# API documentation:')) {
          await ctx.log({
            stage: 'file generation',
            severity: 'warning',
            message:
              'No parsed api_doc uploads found — endpoints derive only from the ' +
              'approved test cases. Upload API documentation to prevent invented routes.',
            progress: 30,
          });
        }
      }
      const targetBaseUrl =
        testType === 'api'
          ? project.apiBaseUrl || project.baseUrl
          : project.baseUrl;

      const output = await this.engine.automation(
        {
          testCases: cases.map((c) => ({
            id: c.id,
            case_key: c.caseKey,
            title: c.title,
            steps: c.steps ?? [],
            expected_results: c.expectedResults ?? [],
            test_data: c.testData ?? {},
            preconditions: c.preconditions ?? [],
            requirement_ids: c.requirementIds ?? [],
          })),
          baseUrl: targetBaseUrl,
          pageObjectsSummary: '',
          model: llm.type === 'local' ? llm.model : undefined,
          temperature: project.llmTemperature,
          testType,
          extraMarkers,
          apiSummary,
          llm,
        },
        correlationId,
        idempotencyKey,
      );
      await ctx.log({
        stage: 'formatting',
        message: 'Generated files returned; formatting and persisting artefacts',
        progress: 80,
      });

      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'automation',
          jobId: job.id,
          model: llm.model ?? '',
          temperature: project.llmTemperature,
          contentHash: contentHash(output),
          status: 'completed',
        }),
      );

      const files = (output.files as Record<string, unknown>[]) || [];
      const artifactIds: string[] = [];
      for (const f of files) {
        const saved = await this.artifacts.save(
          this.artifacts.create({
            projectId,
            generationRunId: run.id,
            testCaseIds: (f.test_case_ids as string[]) || dto.testCaseIds,
            path: (f.path as string) || 'generated_test.py',
            kind: (f.kind as string) || 'test_file',
            content: (f.content as string) || '',
            diff: '',
            traceability: {
              testCaseIds: (f.test_case_ids as string[]) || dto.testCaseIds,
              notes: (output.notes as string) || '',
            },
            contentHash: contentHash(f.content || ''),
            version: 1,
            status: 'active',
            validationStatus: 'pending',
            approvalStatus: 'pending',
            schemaVersion: (output.schema_version as string) || 'v1',
            testType,
            regressionSuite,
            createdBy: user.id,
          }),
        );
        artifactIds.push(saved.id);
      }

      this.events.emit({
        type: 'automation.ready',
        projectId,
        jobId: job.id,
        correlationId,
        payload: { artifactIds, count: artifactIds.length },
      });

      return {
        resultRefs: { artifactIds, generationRunId: run.id },
        readyEvent: {
          type: 'automation.ready' as const,
          payload: { artifactIds, count: artifactIds.length },
        },
      };
    });

    return { jobId: job.id, status: job.status };
  }

  async getOne(id: string, user: AuthUser): Promise<GeneratedArtifact> {
    const art = await this.artifacts.findOne({ where: { id } });
    if (!art) throw new NotFoundAppException(`Automation artifact ${id} not found`);
    await this.membership.ensureMember(art.projectId, user);
    return art;
  }

  /**
   * Save an in-place edit of a generated script (editable code editor).
   *
   * The edited code is untrusted until re-checked, so saving resets the
   * artefact to Draft: validation returns to `pending` and any prior approval
   * is invalidated (FR-VAL-007 — a change to generated code requires
   * revalidation and reapproval before it can execute). The content hash is
   * recomputed and the version incremented so the latest edit is the one that
   * materialises at execution time (AC-004/AC-005). A no-op edit (identical
   * content) is returned unchanged so re-saving does not churn the version.
   */
  async updateContent(
    id: string,
    content: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<GeneratedArtifact> {
    const art = await this.getOne(id, user);
    if (art.status !== 'active') {
      throw new ConflictAppException(
        `Automation ${id} is ${art.status} and cannot be edited.`,
        'invalid_state_transition',
        { artifactId: id, status: art.status },
      );
    }
    if (content === art.content) {
      return art; // nothing changed — do not bump version or invalidate
    }

    // Persist the new content first; edited code is unvalidated again
    // (FR-VAL-007). Approval invalidation is delegated to the canonical
    // upstream-modified path below, which reads the freshly-saved row.
    art.content = content;
    art.contentHash = contentHash(content);
    art.version += 1;
    art.diff = '';
    art.validationStatus = 'pending';
    art.validationReport = null;
    await this.artifacts.save(art);

    // If it had been approved, reopen the approval gate, mark prior approval
    // records invalidated and emit approval.updated (mirrors any upstream
    // change to generated code, FR-VAL-007).
    await this.approvals.onUpstreamModified(
      'automation',
      id,
      user,
      correlationId,
    );

    const updated = await this.getOne(id, user);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.edit',
      resourceType: 'automation',
      resourceId: id,
      projectId: updated.projectId,
      correlationId,
      metadata: {
        version: updated.version,
        contentHash: updated.contentHash,
        revalidationRequired: true,
        approvalInvalidated: updated.approvalInvalidated,
      },
    });

    // Nudge any open Automation pages to refetch (FR-BE-004).
    this.events.emit({
      type: 'automation.ready',
      projectId: updated.projectId,
      correlationId,
      payload: { artifactIds: [id], count: 1, reason: 'edited' },
    });

    return updated;
  }

  async listByProject(
    projectId: string,
    user: AuthUser,
  ): Promise<GeneratedArtifact[]> {
    await this.membership.ensureMember(projectId, user);
    return this.artifacts.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Validation runs as an async job with a live log console
   * (FR-V3-LOG-005, §23.7 validation state machine).
   */
  async validate(id: string, user: AuthUser, correlationId?: string) {
    const art = await this.getOne(id, user);
    const project = await this.projects.findOne({
      where: { id: art.projectId },
    });

    const job = await this.jobs.create({
      projectId: art.projectId,
      type: 'validation',
      correlationId,
      inputRefs: { artifactId: id, path: art.path },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.validate',
      resourceType: 'automation',
      resourceId: id,
      projectId: art.projectId,
      correlationId,
      metadata: { jobId: job.id },
    });

    art.validationStatus = 'running';
    await this.artifacts.save(art);

    this.jobs.dispatch(job, async (j, ctx) => {
      await ctx.log({
        stage: 'syntax',
        message: `Validating ${art.path}: Python syntax, imports and Pytest collection`,
        progress: 15,
      });
      const report = await this.engine.validate(
        {
          files: [{ path: art.path, content: art.content }],
          allowedDomains: (
            project?.allowedDomains || 'localhost,127.0.0.1'
          ).split(','),
          runCollection: true,
        },
        correlationId,
      );
      await ctx.log({
        stage: 'policy scan',
        message:
          'Checking forbidden operations, hard-coded secrets, locator quality and the domain allow-list',
        progress: 70,
      });

      const passed = report.passed === true;
      const findings = (report.issues as { severity?: string }[]) || [];
      const warnings = findings.filter(
        (f) => (f.severity || '').toLowerCase() === 'warning',
      );
      const fresh = await this.artifacts.findOne({ where: { id } });
      if (fresh) {
        fresh.validationReport = report;
        fresh.validationStatus = passed
          ? warnings.length
            ? 'passed_with_warnings'
            : 'passed'
          : 'failed';
        await this.artifacts.save(fresh);
      }
      await ctx.log({
        stage: 'result',
        severity: passed ? (warnings.length ? 'warning' : 'success') : 'error',
        message: passed
          ? warnings.length
            ? `Validation passed with ${warnings.length} warning(s)`
            : 'Validation passed'
          : `Validation failed with ${findings.length} finding(s)`,
        progress: 95,
      });

      this.events.emit({
        type: 'validation.ready',
        projectId: art.projectId,
        jobId: job.id,
        correlationId,
        payload: {
          artifactId: id,
          passed,
          validationStatus: fresh?.validationStatus,
        },
      });

      return {
        resultRefs: {
          artifactId: id,
          validationStatus: fresh?.validationStatus ?? 'failed',
        },
        warnings: warnings.length && passed ? [`${warnings.length} validation warning(s)`] : [],
      };
    });

    return { jobId: job.id, status: job.status, artifactId: id };
  }

  /**
   * Governed validation exception (FR-V3-ENT-002, §23.3): an authorised role
   * can override a failed validation with a recorded reason. The artefact
   * moves to the `overridden` validation state and the decision is stored as
   * a `validation_exception` approval record.
   */
  async overrideValidation(
    id: string,
    reason: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const art = await this.getOne(id, user);
    if (!reason?.trim()) {
      throw new ConflictAppException(
        'A written reason is required to override validation.',
        'reason_required',
      );
    }
    art.validationStatus = 'overridden';
    await this.artifacts.save(art);
    await this.approvals.recordStandalone(
      'validation_exception',
      id,
      art.projectId,
      'approved',
      reason,
      user,
      correlationId,
    );
    this.events.emit({
      type: 'validation.ready',
      projectId: art.projectId,
      correlationId,
      payload: { artifactId: id, passed: true, validationStatus: 'overridden' },
    });
    return { artifactId: id, validationStatus: art.validationStatus };
  }

  async approve(
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const art = await this.getOne(id, user);
    // FR-AUT-010 precondition: an artefact must be validated before approval
    // (a governed override counts, §23.3).
    const validated = ['passed', 'passed_with_warnings', 'overridden'].includes(
      art.validationStatus,
    );
    if (decision === 'approved' && !validated) {
      throw new ConflictAppException(
        `Automation ${id} must pass validation before approval ` +
          `(current: ${art.validationStatus}).`,
        'validation_required',
        { artifactId: id, validationStatus: art.validationStatus },
      );
    }
    return this.approvals.decide(
      'automation',
      id,
      decision,
      comment,
      user,
      correlationId,
    );
  }

  async executionPlan(id: string, user: AuthUser, correlationId?: string) {
    const art = await this.getOne(id, user);
    const project = await this.projects.findOne({
      where: { id: art.projectId },
    });
    const cases = await this.cases.find({
      where: { id: In(art.testCaseIds ?? []) },
    });
    const raw = (await this.engine.executionPlan(
      {
        testCases: cases.map((c) => ({
          id: c.id,
          case_key: c.caseKey,
          title: c.title,
          steps: c.steps ?? [],
          expected_results: c.expectedResults ?? [],
        })),
        baseUrl: project?.baseUrl || '',
      },
      correlationId,
    )) as { schema_version?: string; plans?: Record<string, unknown>[] };

    // Normalise the engine's snake_case wire format to the API contract's
    // camelCase (AIQA-EXEC-004: the raw pass-through crashed the frontend,
    // which reads plan.testCaseId / step.actionType).
    const plans = (raw.plans ?? []).map((p) => ({
      testCaseId: String(p.test_case_id ?? p.testCaseId ?? ''),
      caseKey: String(p.case_key ?? p.caseKey ?? ''),
      title: String(p.title ?? ''),
      steps: ((p.steps as Record<string, unknown>[]) ?? []).map((s) => ({
        sequence: Number(s.sequence ?? 0),
        actionType: String(s.action_type ?? s.actionType ?? ''),
        target: String(s.target ?? ''),
        description: String(s.description ?? ''),
        expected: String(s.expected ?? ''),
      })),
    }));
    return { schemaVersion: raw.schema_version ?? 'v1', plans };
  }
}
