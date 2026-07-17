import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import {
  ExecutionEvent,
  ExecutionRun,
  GeneratedArtifact,
  Project,
  TestResult,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient, EngineSseEvent } from '../../engine/engine.client';
import { CreateExecutionDto } from './dto/execution.dto';

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    @InjectRepository(ExecutionEvent)
    private readonly execEvents: Repository<ExecutionEvent>,
    @InjectRepository(TestResult)
    private readonly results: Repository<TestResult>,
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly engine: EngineClient,
  ) {}

  async create(
    dto: CreateExecutionDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(dto.projectId, user);
    const project = await this.projects.findOne({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new NotFoundAppException(`Project ${dto.projectId} not found`);
    }

    let testPaths: string[] = dto.testPaths ?? [];
    const automationIds = dto.automationIds ?? [];

    // Gate (FR-AUT-010): only approved + validated + active automation runs.
    if (automationIds.length) {
      const arts = await this.artifacts.find({
        where: { id: In(automationIds), projectId: dto.projectId },
      });
      if (arts.length !== automationIds.length) {
        throw new NotFoundAppException(
          'One or more automation artifacts were not found in this project',
        );
      }
      const blocked = arts.filter(
        (a) =>
          a.status !== 'active' ||
          a.approvalStatus !== 'approved' ||
          a.validationStatus !== 'passed',
      );
      if (blocked.length) {
        throw new ConflictAppException(
          `Cannot execute: ${blocked.length} automation artifact(s) are not ` +
            `approved+validated+active. Approve and validate them first.`,
          'automation_not_ready',
          {
            blocked: blocked.map((a) => ({
              id: a.id,
              status: a.status,
              approvalStatus: a.approvalStatus,
              validationStatus: a.validationStatus,
            })),
          },
        );
      }
      testPaths = [...testPaths, ...arts.map((a) => a.path)];
    }

    if (!testPaths.length) {
      throw new ValidationFailedException(
        'Nothing to execute: provide automationIds (approved+validated) or testPaths.',
      );
    }

    const run = await this.runs.save(
      this.runs.create({
        projectId: dto.projectId,
        mode: 'local',
        status: 'queued',
        environment: dto.environment || 'local',
        browser: dto.browser || 'chromium',
        headed: !!dto.headed,
        automationIds,
        testPaths,
        correlationId: correlationId || '',
        createdBy: user.id,
      }),
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'execution.start',
      resourceType: 'execution',
      resourceId: run.id,
      projectId: dto.projectId,
      correlationId,
      metadata: { automationIds, testPaths, browser: run.browser },
    });

    // Kick off the engine run; do not await the stream (ack < 2s).
    try {
      await this.engine.execute(
        {
          runId: run.id,
          testPaths,
          browser: run.browser,
          headed: run.headed,
          environment: run.environment,
          allowedDomains: project.allowedDomains,
          targetBaseUrl: project.baseUrl,
          markers: dto.markers || '',
        },
        correlationId,
        idempotencyKey,
      );
    } catch (err) {
      run.status = 'error';
      run.metrics = { error: (err as Error).message };
      run.finishedAt = new Date();
      await this.runs.save(run);
      throw err;
    }

    run.status = 'running';
    run.startedAt = new Date();
    await this.runs.save(run);

    void this.consumeStream(run.id, dto.projectId, correlationId);

    return { id: run.id, status: run.status, testPaths };
  }

  /** Consume the engine SSE stream, persist ExecutionEvents, rebroadcast (FR-EXE-006/007/008). */
  private async consumeStream(
    runId: string,
    projectId: string,
    correlationId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    const testOutcomes = new Map<string, string>();

    const onEvent = async (evt: EngineSseEvent) => {
      const type =
        evt.type === 'execution.status' ? 'execution.status' : 'execution.step';
      const payload = evt.payload || {};

      // Broadcast with a backend-assigned monotonic seq, then persist it.
      const envelope = this.events.emit({
        type,
        projectId,
        runId,
        correlationId,
        payload,
      });

      await this.execEvents.save(
        this.execEvents.create({
          executionRunId: runId,
          projectId,
          seq: envelope.seq,
          type,
          testCaseId: String(payload.test_case_id ?? ''),
          testName: String(payload.test_name ?? ''),
          sequence: Number(payload.sequence ?? 0),
          actionType: String(payload.action_type ?? ''),
          target: String(payload.target ?? ''),
          valueSummary: String(payload.value_summary ?? ''),
          status: String(payload.status ?? ''),
          currentUrl: String(payload.current_url ?? ''),
          elapsedMs: Number(payload.elapsed_ms ?? 0),
          evidenceUri: String(payload.evidence_uri ?? ''),
          ts: String(payload.ts ?? ''),
          payload,
        }),
      );

      // Track per-test terminal outcomes from test-level step events.
      if (
        type === 'execution.step' &&
        payload.action_type === 'test' &&
        ['passed', 'failed', 'skipped'].includes(String(payload.status))
      ) {
        testOutcomes.set(
          String(payload.test_name || payload.test_case_id || ''),
          String(payload.status),
        );
      }

      if (type === 'execution.status') {
        await this.onStatusEvent(runId, payload, testOutcomes);
      }
    };

    try {
      await this.engine.streamRunEvents(runId, onEvent, {
        correlationId,
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn(
        `event stream for run ${runId} ended with error: ${(err as Error).message}`,
      );
    } finally {
      this.abortControllers.delete(runId);
      await this.finalize(runId, testOutcomes);
    }
  }

  private async onStatusEvent(
    runId: string,
    payload: Record<string, unknown>,
    _testOutcomes: Map<string, string>,
  ): Promise<void> {
    const status = String(payload.status || '');
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return;
    if (status === 'completed' || status === 'error' || status === 'cancelled') {
      run.status = status as ExecutionRun['status'];
      run.metrics = (payload.metrics as Record<string, unknown>) || run.metrics;
      run.finishedAt = new Date();
      await this.runs.save(run);
    } else if (status === 'running' && run.status === 'queued') {
      run.status = 'running';
      run.startedAt = run.startedAt || new Date();
      await this.runs.save(run);
    }
  }

  private async finalize(
    runId: string,
    testOutcomes: Map<string, string>,
  ): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return;

    // Persist per-test results derived from streamed test events (FR-RES-001).
    const existing = await this.results.count({
      where: { executionRunId: runId },
    });
    if (!existing && testOutcomes.size) {
      const rows = [...testOutcomes.entries()].map(([nodeId, outcome]) =>
        this.results.create({
          executionRunId: runId,
          nodeId,
          outcome,
          durationSeconds: 0,
          errorMessage: '',
          evidence: null,
        }),
      );
      await this.results.save(rows);
    }

    if (run.status === 'running' || run.status === 'queued') {
      run.status = 'completed';
      run.finishedAt = run.finishedAt || new Date();
      await this.runs.save(run);
    }
  }

  async getOne(id: string, user: AuthUser): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundAppException(`Execution ${id} not found`);
    await this.membership.ensureMember(run.projectId, user);
    return run;
  }

  async getEvents(
    id: string,
    user: AuthUser,
    fromSeq = 0,
  ): Promise<ExecutionEvent[]> {
    await this.getOne(id, user);
    return this.execEvents.find({
      where: {
        executionRunId: id,
        ...(fromSeq ? { seq: MoreThan(fromSeq) } : {}),
      },
      order: { seq: 'ASC' },
    });
  }

  async cancel(id: string, user: AuthUser, correlationId?: string) {
    const run = await this.getOne(id, user);
    const controller = this.abortControllers.get(id);
    const res = await this.engine.cancelExecution(id, correlationId);
    run.status = 'cancelled';
    run.finishedAt = new Date();
    await this.runs.save(run);
    if (controller) controller.abort();
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'execution.cancel',
      resourceType: 'execution',
      resourceId: id,
      projectId: run.projectId,
      correlationId,
    });
    this.events.emit({
      type: 'execution.status',
      projectId: run.projectId,
      runId: id,
      correlationId,
      payload: { run_id: id, status: 'cancelled' },
    });
    return { id, cancelled: res.cancelled, status: 'cancelled' };
  }

  async getResults(id: string, user: AuthUser): Promise<TestResult[]> {
    await this.getOne(id, user);
    return this.results.find({ where: { executionRunId: id } });
  }

  async getStoredReport(
    id: string,
    user: AuthUser,
  ): Promise<Record<string, unknown> | null> {
    const run = await this.getOne(id, user);
    return run.report;
  }
}
