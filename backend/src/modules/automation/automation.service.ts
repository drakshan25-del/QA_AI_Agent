import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  GeneratedArtifact,
  GenerationRun,
  Project,
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
import { GenerateAutomationDto } from './dto/automation.dto';

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    @InjectRepository(TestCase) private readonly cases: Repository<TestCase>,
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

    const job = await this.jobs.create({
      projectId,
      type: 'automation',
      correlationId,
      idempotencyKey,
      inputRefs: { testCaseIds: dto.testCaseIds, draftPreview: !!dto.draftPreview },
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
      metadata: { testCases: cases.length, draftPreview: !!dto.draftPreview },
    });

    this.jobs.dispatch(job, async () => {
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
          })),
          baseUrl: project.baseUrl,
          pageObjectsSummary: '',
          model: project.llmModel || undefined,
          temperature: project.llmTemperature,
        },
        correlationId,
        idempotencyKey,
      );

      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'automation',
          jobId: job.id,
          model: project.llmModel,
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

  async validate(id: string, user: AuthUser, correlationId?: string) {
    const art = await this.getOne(id, user);
    const project = await this.projects.findOne({
      where: { id: art.projectId },
    });
    const report = await this.engine.validate(
      {
        files: [{ path: art.path, content: art.content }],
        allowedDomains: (project?.allowedDomains || 'localhost,127.0.0.1').split(
          ',',
        ),
        runCollection: true,
      },
      correlationId,
    );
    const passed = report.passed === true;
    art.validationReport = report;
    art.validationStatus = passed ? 'passed' : 'failed';
    await this.artifacts.save(art);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.validate',
      resourceType: 'automation',
      resourceId: id,
      projectId: art.projectId,
      correlationId,
      metadata: { passed },
    });

    this.events.emit({
      type: 'validation.ready',
      projectId: art.projectId,
      correlationId,
      payload: { artifactId: id, passed },
    });

    return { artifactId: id, validationStatus: art.validationStatus, report };
  }

  async approve(
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const art = await this.getOne(id, user);
    // FR-AUT-010 precondition: an artefact must be validated before approval.
    if (decision === 'approved' && art.validationStatus !== 'passed') {
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
    return this.engine.executionPlan(
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
    );
  }
}
