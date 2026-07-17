import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestPlan,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { contentHash } from '../../common/hash';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { ApprovalDecision } from '../../common/enums';
import { GenerateTestPlanDto, UpdateTestPlanDto } from './dto/test-plan.dto';

@Injectable()
export class TestPlansService {
  constructor(
    @InjectRepository(TestPlan) private readonly plans: Repository<TestPlan>,
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
    private readonly engine: EngineClient,
  ) {}

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

    const reqWhere = dto.requirementIds?.length
      ? { projectId, id: In(dto.requirementIds) }
      : { projectId };
    const requirements = await this.requirements.find({ where: reqWhere });
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

    this.jobs.dispatch(job, async () => {
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
          model: project.llmModel || undefined,
          temperature: project.llmTemperature,
        },
        correlationId,
        idempotencyKey,
      );

      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'test_plan',
          jobId: job.id,
          model: project.llmModel,
          temperature: project.llmTemperature,
          contentHash: contentHash(output),
          status: 'completed',
        }),
      );

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
          model: project.llmModel,
          createdBy: user.id,
        }),
      );

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

  async listByProject(projectId: string, user: AuthUser): Promise<TestPlan[]> {
    await this.membership.ensureMember(projectId, user);
    return this.plans.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string, user: AuthUser): Promise<TestPlan> {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundAppException(`Test plan ${id} not found`);
    await this.membership.ensureMember(plan.projectId, user);
    return plan;
  }

  async update(
    id: string,
    dto: UpdateTestPlanDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<TestPlan> {
    const plan = await this.getOne(id, user);
    if (dto.title !== undefined) plan.title = dto.title;
    if (dto.sections) {
      plan.sections = { ...(plan.sections || {}), ...dto.sections };
    }
    plan.version += 1;
    plan.contentHash = contentHash(plan.sections);
    const saved = await this.plans.save(plan);

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
      metadata: { version: saved.version },
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
    await this.getOne(id, user);
    return this.approvals.decide(
      'test_plan',
      id,
      decision,
      comment,
      user,
      correlationId,
    );
  }

  async export(
    id: string,
    format: string,
    user: AuthUser,
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const plan = await this.getOne(id, user);
    const base = `test-plan-${plan.id}`;
    if (format === 'json') {
      return {
        contentType: 'application/json',
        filename: `${base}.json`,
        body: JSON.stringify(
          { id: plan.id, title: plan.title, sections: plan.sections },
          null,
          2,
        ),
      };
    }
    const md = renderTestPlanMarkdown(plan.title, plan.sections);
    // docx/pdf are delivered as Markdown text in this tier (documented gap).
    const contentType =
      format === 'md'
        ? 'text/markdown'
        : format === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : format === 'pdf'
            ? 'application/pdf'
            : 'text/markdown';
    const ext = ['md', 'docx', 'pdf'].includes(format) ? format : 'md';
    return { contentType, filename: `${base}.${ext}`, body: md };
  }
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
