import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestCase,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { contentHash } from '../../common/hash';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { GenerateTestCasesDto, UpdateTestCaseDto } from './dto/test-case.dto';

export interface TestCaseFilter {
  source?: string;
  priority?: string;
  type?: string;
  approval?: string;
  automation?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class TestCasesService {
  constructor(
    @InjectRepository(TestCase) private readonly cases: Repository<TestCase>,
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
    dto: GenerateTestCasesDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const requirements = await this.requirements.find({
      where: { projectId, id: In(dto.requirementIds) },
    });
    if (!requirements.length) {
      throw new NotFoundAppException('No matching requirements found');
    }

    const job = await this.jobs.create({
      projectId,
      type: 'test_cases',
      correlationId,
      idempotencyKey,
      inputRefs: { requirementIds: dto.requirementIds, minCases: dto.minCases },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'test_cases.generate',
      resourceType: 'job',
      resourceId: job.id,
      projectId,
      correlationId,
    });

    this.jobs.dispatch(job, async () => {
      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'test_cases',
          jobId: job.id,
          model: project.llmModel,
          temperature: project.llmTemperature,
          status: 'completed',
        }),
      );

      const caseIds: string[] = [];
      for (const req of requirements) {
        const analysis = await this.analyses.findOne({
          where: { projectId, requirementId: req.id },
          order: { createdAt: 'DESC' },
        });
        const output = await this.engine.testCases(
          {
            requirement: {
              id: req.id,
              title: req.title,
              text: req.text,
              acceptance_criteria: req.acceptanceCriteria ?? [],
            },
            analysis: analysis?.output,
            minCases: dto.minCases ?? 10,
            model: project.llmModel || undefined,
            temperature: project.llmTemperature,
          },
          correlationId,
          `${idempotencyKey || job.id}:${req.id}`,
        );

        const list = (output.test_cases as Record<string, unknown>[]) || [];
        for (const tc of list) {
          const saved = await this.cases.save(
            this.cases.create({
              projectId,
              generationRunId: run.id,
              requirementIds: ((tc.requirement_ids as string[]) || [req.id]),
              caseKey: (tc.case_key as string) || '',
              title: (tc.title as string) || 'Untitled',
              objective: (tc.objective as string) || '',
              category: (tc.category as string) || 'positive',
              priority: (tc.priority as string) || 'medium',
              preconditions: (tc.preconditions as string[]) || [],
              testData: (tc.test_data as Record<string, string>) || {},
              steps: (tc.steps as string[]) || [],
              expectedResults: (tc.expected_results as string[]) || [],
              automationSuitability:
                (tc.automation_suitability as string) || 'automatable',
              source: 'ai',
              approvalStatus: 'pending',
              automationStatus: 'none',
              version: 1,
              contentHash: contentHash(tc),
              createdBy: user.id,
            }),
          );
          caseIds.push(saved.id);
        }
      }

      this.events.emit({
        type: 'cases.ready',
        projectId,
        jobId: job.id,
        correlationId,
        payload: { testCaseIds: caseIds, count: caseIds.length },
      });

      return {
        resultRefs: { testCaseIds: caseIds, generationRunId: run.id },
        readyEvent: {
          type: 'cases.ready' as const,
          payload: { testCaseIds: caseIds, count: caseIds.length },
        },
      };
    });

    return { jobId: job.id, status: job.status };
  }

  async list(
    projectId: string,
    filter: TestCaseFilter,
    user: AuthUser,
  ): Promise<{ items: TestCase[]; total: number; page: number; pageSize: number }> {
    await this.membership.ensureMember(projectId, user);
    const page = Math.max(filter.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 200);

    const qb = this.cases
      .createQueryBuilder('t')
      .where('t.project_id = :projectId', { projectId });
    if (filter.source) qb.andWhere('t.source = :source', { source: filter.source });
    if (filter.priority)
      qb.andWhere('t.priority = :priority', { priority: filter.priority });
    if (filter.type) qb.andWhere('t.category = :type', { type: filter.type });
    if (filter.approval)
      qb.andWhere('t.approval_status = :approval', { approval: filter.approval });
    if (filter.automation)
      qb.andWhere('t.automation_status = :automation', {
        automation: filter.automation,
      });
    if (filter.q)
      qb.andWhere('(t.title LIKE :q OR t.objective LIKE :q)', {
        q: `%${filter.q}%`,
      });

    qb.orderBy('t.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getOne(id: string, user: AuthUser): Promise<TestCase> {
    const tc = await this.cases.findOne({ where: { id } });
    if (!tc) throw new NotFoundAppException(`Test case ${id} not found`);
    await this.membership.ensureMember(tc.projectId, user);
    return tc;
  }

  async update(
    id: string,
    dto: UpdateTestCaseDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<TestCase> {
    const tc = await this.getOne(id, user);
    Object.assign(tc, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.preconditions !== undefined
        ? { preconditions: dto.preconditions }
        : {}),
      ...(dto.steps !== undefined ? { steps: dto.steps } : {}),
      ...(dto.expectedResults !== undefined
        ? { expectedResults: dto.expectedResults }
        : {}),
      ...(dto.testData !== undefined ? { testData: dto.testData } : {}),
      ...(dto.automationSuitability !== undefined
        ? { automationSuitability: dto.automationSuitability }
        : {}),
      source: 'manual',
    });
    tc.version += 1;
    tc.contentHash = contentHash({
      title: tc.title,
      steps: tc.steps,
      expected: tc.expectedResults,
    });
    await this.cases.save(tc);

    // Editing an approved case invalidates downstream automation (FR-VAL-007).
    await this.approvals.onUpstreamModified('test_case', id, user, correlationId);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'test_case.update',
      resourceType: 'test_case',
      resourceId: id,
      projectId: tc.projectId,
      correlationId,
      metadata: { version: tc.version },
    });
    return this.getOne(id, user);
  }

  async approve(
    ids: string[],
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    // Membership check for each case's project.
    for (const id of ids) await this.getOne(id, user);
    return this.approvals.decideBulk(
      'test_case',
      ids,
      decision,
      comment,
      user,
      correlationId,
    );
  }

  /** Coverage per requirement (FR-TC-006). */
  async coverage(
    projectId: string,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.membership.ensureMember(projectId, user);
    const [requirements, cases] = await Promise.all([
      this.requirements.find({ where: { projectId } }),
      this.cases.find({ where: { projectId } }),
    ]);
    const perRequirement = requirements.map((r) => {
      const covering = cases.filter((c) =>
        (c.requirementIds ?? []).includes(r.id),
      );
      return {
        requirementId: r.id,
        title: r.title,
        testCaseCount: covering.length,
        approvedCount: covering.filter((c) => c.approvalStatus === 'approved')
          .length,
        covered: covering.length > 0,
      };
    });
    const covered = perRequirement.filter((r) => r.covered).length;
    return {
      totalRequirements: requirements.length,
      coveredRequirements: covered,
      coveragePercent: requirements.length
        ? Math.round((covered / requirements.length) * 100)
        : 0,
      totalTestCases: cases.length,
      perRequirement,
    };
  }
}
