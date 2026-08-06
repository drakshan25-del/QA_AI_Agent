import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { deriveArtefactState } from '../../common/state-machines';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
import { SequencesService } from '../sequences/sequences.service';
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

/** Render TC-{int}, optionally zero-padded per project setting (FR-V3-TC-001/004). */
export function formatTestCaseId(seq: number, zeroPad = 0): string {
  const n = zeroPad > 0 ? String(seq).padStart(zeroPad, '0') : String(seq);
  return `TC-${n}`;
}

@Injectable()
export class TestCasesService implements OnModuleInit {
  private readonly logger = new Logger(TestCasesService.name);

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
    private readonly derivation: RequirementDerivationService,
    private readonly sequences: SequencesService,
    private readonly engine: EngineClient,
  ) {
    this.jobs.registerRetryHandler('test_cases', (original, user, correlationId) =>
      this.generate(
        original.projectId,
        {
          requirementIds:
            (original.inputRefs?.requirementIds as string[]) ?? undefined,
          minCases: (original.inputRefs?.minCases as number) ?? undefined,
        },
        user,
        correlationId,
      ),
    );
  }

  /**
   * Backfill TC-{int} identifiers for rows created before V3 (FR-V3-TC-001),
   * in creation order, then raise the sequence above the maximum so new
   * generations never collide.
   */
  async onModuleInit(): Promise<void> {
    try {
      const legacy = await this.cases.find({
        where: { seq: 0 },
        order: { createdAt: 'ASC' },
      });
      if (!legacy.length) return;
      const byProject = new Map<string, TestCase[]>();
      for (const tc of legacy) {
        const list = byProject.get(tc.projectId) ?? [];
        list.push(tc);
        byProject.set(tc.projectId, list);
      }
      for (const [projectId, list] of byProject) {
        const project = await this.projects.findOne({ where: { id: projectId } });
        const start = await this.sequences.next(projectId, 'test_case', list.length);
        list.forEach((tc, i) => {
          tc.seq = start + i;
          tc.humanId = formatTestCaseId(tc.seq, project?.tcZeroPad ?? 0);
        });
        await this.cases.save(list);
        this.logger.log(
          `Backfilled ${list.length} test-case IDs for project ${projectId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`test-case ID backfill skipped: ${(err as Error).message}`);
    }
  }

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

    // Cover uploaded documents too: derive requirements from their segments
    // and add them to the explicitly requested set (FR-IN-008).
    const requirements = await this.derivation.resolveGenerationScope(
      projectId,
      dto.requirementIds,
      undefined,
      user,
      correlationId,
    );
    if (!requirements.length) {
      throw new NotFoundAppException(
        'No matching requirements found. Add requirements or upload documents first.',
      );
    }

    const job = await this.jobs.create({
      projectId,
      type: 'test_cases',
      correlationId,
      idempotencyKey,
      inputRefs: {
        requirementIds: requirements.map((r) => r.id),
        minCases: dto.minCases,
      },
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

    this.jobs.dispatch(job, async (j, ctx) => {
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

      await ctx.log({
        stage: 'scenario discovery',
        message: `Generating test cases for ${requirements.length} requirement(s) with ${project.llmModel || 'the default model'}`,
        progress: 8,
      });

      const caseIds: string[] = [];
      let index = 0;
      for (const req of requirements) {
        await ctx.checkpoint();
        index += 1;
        const progressBase = 8 + Math.round((index - 1) / requirements.length * 80);
        await ctx.log({
          stage: 'scenario discovery',
          message: `Requirement ${index}/${requirements.length}: "${req.title || req.id}" — discovering positive, negative and boundary scenarios`,
          progress: progressBase,
        });

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
        await ctx.log({
          stage: 'numbering',
          message: `Requirement ${index}/${requirements.length}: assigning ${list.length} TC identifiers from the project sequence`,
          progress: progressBase + Math.round(80 / requirements.length / 2),
        });

        // Concurrency-safe block reservation (FR-V3-TC-001/003).
        const firstSeq = list.length
          ? await this.sequences.next(projectId, 'test_case', list.length)
          : 0;

        let offset = 0;
        for (const tc of list) {
          const seq = firstSeq + offset;
          offset += 1;
          const saved = await this.cases.save(
            this.cases.create({
              projectId,
              generationRunId: run.id,
              requirementIds: ((tc.requirement_ids as string[]) || [req.id]),
              caseKey: (tc.case_key as string) || '',
              seq,
              humanId: formatTestCaseId(seq, project.tcZeroPad),
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
        await ctx.log({
          stage: 'persistence',
          severity: 'success',
          message: `Requirement ${index}/${requirements.length}: saved ${list.length} case(s) (${list.length ? `${formatTestCaseId(firstSeq, project.tcZeroPad)}…${formatTestCaseId(firstSeq + list.length - 1, project.tcZeroPad)}` : 'none'})`,
          progress: 8 + Math.round(index / requirements.length * 80),
        });
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
      qb.andWhere('(t.title LIKE :q OR t.objective LIKE :q OR t.human_id LIKE :q)', {
        q: `%${filter.q}%`,
      });

    qb.orderBy('t.seq', 'ASC')
      .addOrderBy('t.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((c) =>
        Object.assign(c, { artefactState: deriveArtefactState(c) }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async getOne(id: string, user: AuthUser): Promise<TestCase> {
    const tc = await this.cases.findOne({ where: { id } });
    if (!tc) throw new NotFoundAppException(`Test case ${id} not found`);
    await this.membership.ensureMember(tc.projectId, user);
    return Object.assign(tc, { artefactState: deriveArtefactState(tc) });
  }

  async update(
    id: string,
    dto: UpdateTestCaseDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<TestCase> {
    const tc = await this.getOne(id, user);
    // FR-V3-TC-002: editing never reassigns seq/humanId — identity is stable.
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
      metadata: { version: tc.version, humanId: tc.humanId },
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
