import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
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
import { Browser, ExecutionStatus, RunScope } from '../../common/enums';
import {
  EXECUTION_TRANSITIONS,
  assertTransition,
  isTerminalExecutionStatus,
  outcomeFromMetrics,
} from '../../common/state-machines';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient, EngineSseEvent } from '../../engine/engine.client';
import { CreateExecutionDto, ExecutionSettingsDto } from './dto/execution.dto';

/** Effective run settings persisted with the run (FR-V3-EXE-011). */
export interface EffectiveSettings {
  timeoutSeconds: number;
  retries: number;
  workers: number;
  slowMoMs: number;
  screenshotMode: 'on-failure' | 'every-test' | 'off';
  video: boolean;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly abortControllers = new Map<string, AbortController>();
  /** Runs currently executing on this host (FR-V3-EXE-012). */
  private readonly activeRuns = new Set<string>();
  /** Serialises pump passes so two concurrent pumps can never dispatch the
   * same queued run or under-count `activeRuns` (FR-V3-EXE-012). */
  private pumpChain: Promise<void> = Promise.resolve();

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
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly engine: EngineClient,
  ) {}

  private get limits(): AppConfig['execution'] {
    return (
      this.config.get<AppConfig['execution']>('execution') ?? {
        maxConcurrent: 1,
        maxTimeoutSeconds: 1800,
        maxRetries: 3,
        maxWorkers: 4,
        maxSlowMoMs: 2000,
      }
    );
  }

  /** Validate requested settings against admin-defined limits (FR-V3-EXE-011). */
  private resolveSettings(dto?: ExecutionSettingsDto): EffectiveSettings {
    const limits = this.limits;
    const req = dto ?? {};
    const problems: string[] = [];
    const timeoutSeconds = req.timeoutSeconds ?? 900;
    const retries = req.retries ?? 0;
    const workers = req.workers ?? 1;
    const slowMoMs = req.slowMoMs ?? 0;
    if (timeoutSeconds < 30 || timeoutSeconds > limits.maxTimeoutSeconds) {
      problems.push(`timeoutSeconds must be 30..${limits.maxTimeoutSeconds}`);
    }
    if (retries < 0 || retries > limits.maxRetries) {
      problems.push(`retries must be 0..${limits.maxRetries}`);
    }
    if (workers < 1 || workers > limits.maxWorkers) {
      problems.push(`workers must be 1..${limits.maxWorkers}`);
    }
    if (slowMoMs < 0 || slowMoMs > limits.maxSlowMoMs) {
      problems.push(`slowMoMs must be 0..${limits.maxSlowMoMs}`);
    }
    if (problems.length) {
      throw new ValidationFailedException(
        `Execution settings out of the administrator-defined range: ${problems.join('; ')}.`,
        { limits },
      );
    }
    return {
      timeoutSeconds,
      retries,
      workers,
      slowMoMs,
      screenshotMode: req.screenshotMode ?? 'on-failure',
      video: !!req.video,
    };
  }

  /**
   * Resolve the run scope (FR-V3-EXE-007): selected automation, all approved
   * automation, or the test paths that failed in the most recent finished run.
   */
  private async resolveScope(
    dto: CreateExecutionDto,
  ): Promise<{ testPaths: string[]; automationIds: string[]; scope: RunScope }> {
    const scope: RunScope = dto.runScope ?? 'selected';
    let testPaths: string[] = dto.testPaths ?? [];
    let automationIds = dto.automationIds ?? [];

    if (scope === 'all') {
      const arts = await this.artifacts.find({
        where: {
          projectId: dto.projectId,
          status: 'active',
          approvalStatus: 'approved',
          validationStatus: In(['passed', 'passed_with_warnings', 'overridden']),
        },
      });
      if (!arts.length) {
        throw new ConflictAppException(
          'Run All: no approved + validated automation exists in this project.',
          'automation_not_ready',
        );
      }
      automationIds = arts.map((a) => a.id);
      testPaths = [];
    } else if (scope === 'failed') {
      const lastRun = await this.runs.findOne({
        where: {
          projectId: dto.projectId,
          mode: 'local',
          status: Not(In(['queued', 'preparing', 'running', 'stopping'])),
        },
        order: { createdAt: 'DESC' },
      });
      if (!lastRun) {
        throw new ConflictAppException(
          'Run Failed Tests: no previous finished run exists for this project.',
          'no_previous_run',
        );
      }
      const failed = await this.results.find({
        where: { executionRunId: lastRun.id, outcome: In(['failed', 'error']) },
      });
      const paths = [
        ...new Set(
          failed
            .map((r) => (r.nodeId || '').split('::')[0])
            .filter((p): p is string => !!p),
        ),
      ];
      if (!paths.length) {
        throw new ConflictAppException(
          `Run Failed Tests: the last run (${lastRun.id}) has no failed tests.`,
          'no_failed_tests',
        );
      }
      automationIds = lastRun.automationIds ?? [];
      testPaths = paths;
    }

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
          !['passed', 'passed_with_warnings', 'overridden'].includes(
            a.validationStatus,
          ),
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
      if (scope !== 'failed') {
        // Page objects are imported dependencies, not test modules — they are
        // materialised but never handed to pytest as collection targets.
        testPaths = [
          ...testPaths,
          ...arts.filter((a) => a.kind !== 'page_object').map((a) => a.path),
        ];
      }
    }

    if (!testPaths.length) {
      throw new ValidationFailedException(
        'Nothing to execute: provide automationIds (approved+validated), testPaths, or use runScope=all.',
      );
    }
    return { testPaths, automationIds, scope };
  }

  async create(
    dto: CreateExecutionDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
    restartOfRunId?: string,
  ) {
    await this.membership.ensureMember(dto.projectId, user);
    const project = await this.projects.findOne({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new NotFoundAppException(`Project ${dto.projectId} not found`);
    }

    const settings = this.resolveSettings(dto.settings);
    const { testPaths, automationIds, scope } = await this.resolveScope(dto);

    const run = await this.runs.save(
      this.runs.create({
        projectId: dto.projectId,
        mode: 'local',
        status: 'queued',
        environment: dto.environment || 'local',
        browser: (dto.browser as Browser) || 'chromium',
        headed: !!dto.headed,
        automationIds,
        testPaths,
        runScope: scope,
        settings: settings as unknown as Record<string, unknown>,
        restartOfRunId: restartOfRunId ?? null,
        correlationId: correlationId || '',
        createdBy: user.id,
      }),
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: restartOfRunId ? 'execution.restart' : 'execution.start',
      resourceType: 'execution',
      resourceId: run.id,
      projectId: dto.projectId,
      correlationId,
      metadata: {
        automationIds,
        testPaths,
        browser: run.browser,
        headed: run.headed,
        runScope: scope,
        settings: settings as unknown as Record<string, unknown>,
        restartOfRunId: restartOfRunId ?? null,
      },
    });

    this.emitStatus(run, correlationId, {
      queued_position: await this.queuedPosition(run.id),
    });

    // Queue + concurrency limit (FR-V3-EXE-012): the run starts immediately
    // when a slot is free, otherwise stays Queued until one frees up.
    void this.pump(correlationId, idempotencyKey);

    return {
      id: run.id,
      status: run.status,
      testPaths,
      runScope: scope,
      browser: run.browser,
      headed: run.headed,
      settings,
    };
  }

  /** Restart control (FR-V3-EXE-008): a new traceable run with the same configuration. */
  async restart(id: string, user: AuthUser, correlationId?: string) {
    const original = await this.getOne(id, user);
    if (!isTerminalExecutionStatus(original.status)) {
      throw new ConflictAppException(
        `Execution ${id} is still ${original.status}; stop it before restarting.`,
        'invalid_state_transition',
      );
    }
    const settings = (original.settings ?? {}) as ExecutionSettingsDto;
    return this.create(
      {
        projectId: original.projectId,
        automationIds: original.automationIds ?? undefined,
        testPaths:
          original.runScope === 'selected' && !original.automationIds?.length
            ? (original.testPaths ?? undefined)
            : undefined,
        browser: original.browser,
        headed: original.headed,
        environment: original.environment,
        runScope: (original.runScope as RunScope) || 'selected',
        settings,
      },
      user,
      correlationId,
      undefined,
      original.id,
    );
  }

  private async queuedPosition(runId: string): Promise<number> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.status !== 'queued') return 0;
    return this.runs
      .createQueryBuilder('r')
      .where('r.mode = :mode AND r.status = :status', {
        mode: 'local',
        status: 'queued',
      })
      .andWhere('r.created_at <= :created', {
        created: run.createdAt,
      })
      .getCount();
  }

  /** Start queued runs while concurrency slots are available (FR-V3-EXE-012).
   * Passes are chained: callers may fire-and-forget, but only one pass ever
   * inspects/mutates `activeRuns` at a time. */
  private pump(correlationId?: string, idempotencyKey?: string): Promise<void> {
    this.pumpChain = this.pumpChain
      .then(() => this.pumpOnce(correlationId, idempotencyKey))
      .catch((err) =>
        this.logger.warn(`pump pass failed: ${(err as Error).message}`),
      );
    return this.pumpChain;
  }

  private async pumpOnce(
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    while (this.activeRuns.size < this.limits.maxConcurrent) {
      const next = await this.runs.findOne({
        where: { status: 'queued', mode: 'local' },
        order: { createdAt: 'ASC' },
      });
      if (!next || this.activeRuns.has(next.id)) return;
      this.activeRuns.add(next.id);
      void this.startRun(next, correlationId, idempotencyKey);
      // Only claim one per loop iteration; startRun is async and re-pumps on exit.
      if (this.activeRuns.size >= this.limits.maxConcurrent) return;
    }
  }

  private emitStatus(
    run: ExecutionRun,
    correlationId?: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.events.emit({
      type: 'execution.status',
      projectId: run.projectId,
      runId: run.id,
      correlationId,
      payload: {
        run_id: run.id,
        status: run.status,
        browser: run.browser,
        headed: run.headed,
        run_scope: run.runScope,
        ...extra,
      },
    });
  }

  private async setStatus(
    run: ExecutionRun,
    to: ExecutionStatus,
    correlationId?: string,
  ): Promise<void> {
    assertTransition(EXECUTION_TRANSITIONS, 'execution', run.status, to);
    run.status = to;
    await this.runs.save(run);
    this.emitStatus(run, correlationId);
  }

  private async startRun(
    run: ExecutionRun,
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    try {
      const fresh = await this.runs.findOne({ where: { id: run.id } });
      if (!fresh || fresh.status !== 'queued') {
        this.activeRuns.delete(run.id);
        return;
      }
      run = fresh;
      const project = await this.projects.findOne({
        where: { id: run.projectId },
      });
      await this.setStatus(run, 'preparing', correlationId);

      // The DB is the artefact store — materialise the approved generated
      // files into the engine workspace with the run submission, otherwise
      // pytest is pointed at paths that exist nowhere on disk (AIQA-EXEC-001).
      // Page objects the tests import are shared dependencies: include every
      // active page object in the project so imports always resolve.
      const files: { path: string; content: string }[] = [];
      const byPath = new Map<string, string>();
      const addArts = (arts: GeneratedArtifact[]) => {
        for (const a of arts) {
          if (a.path && a.content && !byPath.has(a.path)) {
            byPath.set(a.path, a.content);
            files.push({ path: a.path, content: a.content });
          }
        }
      };
      if (run.automationIds?.length) {
        addArts(await this.artifacts.find({ where: { id: In(run.automationIds) } }));
      }
      addArts(
        await this.artifacts.find({
          where: { projectId: run.projectId, status: 'active', kind: 'page_object' },
        }),
      );

      const settings = (run.settings ?? {}) as unknown as EffectiveSettings;
      await this.engine.execute(
        {
          runId: run.id,
          files,
          testPaths: run.testPaths ?? [],
          browser: run.browser,
          headed: run.headed,
          environment: run.environment,
          allowedDomains: project?.allowedDomains ?? 'localhost,127.0.0.1',
          targetBaseUrl: project?.baseUrl ?? '',
          markers: '',
          timeoutSeconds: settings.timeoutSeconds,
          retries: settings.retries,
          workers: settings.workers,
          slowMoMs: settings.slowMoMs,
          screenshotMode: settings.screenshotMode,
          video: settings.video,
        },
        correlationId,
        idempotencyKey,
      );

      run.startedAt = new Date();
      await this.setStatus(run, 'running', correlationId);
      await this.consumeStream(
        run.id,
        run.projectId,
        correlationId,
        settings.timeoutSeconds,
      );
    } catch (err) {
      this.logger.error(
        `run ${run.id} failed to start: ${(err as Error).message}`,
      );
      const fresh = await this.runs.findOne({ where: { id: run.id } });
      if (fresh && !isTerminalExecutionStatus(fresh.status)) {
        fresh.metrics = { error: (err as Error).message };
        fresh.finishedAt = new Date();
        fresh.status = 'failed';
        await this.runs.save(fresh);
        this.emitStatus(fresh, correlationId, {
          error: (err as Error).message,
        });
      }
      this.activeRuns.delete(run.id);
      void this.pump(correlationId);
    }
  }

  /** Consume the engine SSE stream, persist ExecutionEvents, rebroadcast (FR-EXE-006/007/008). */
  private async consumeStream(
    runId: string,
    projectId: string,
    correlationId?: string,
    timeoutSeconds?: number,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    const testOutcomes = new Map<string, string>();

    // Backend-side watchdog (NFR-REL-002): the engine enforces its own run
    // timeout, but if the engine itself stalls or the stream never
    // terminates, this run must not hold its concurrency slot forever.
    const watchdogMs = ((timeoutSeconds ?? 900) + 120) * 1000;
    const watchdog = setTimeout(() => {
      void (async () => {
        this.logger.warn(
          `run ${runId} exceeded ${watchdogMs / 1000}s without terminating; aborting stalled stream`,
        );
        try {
          await this.engine.cancelExecution(runId, correlationId);
        } catch {
          // engine unreachable — abort locally regardless
        }
        const stalled = await this.runs.findOne({ where: { id: runId } });
        if (stalled && !isTerminalExecutionStatus(stalled.status)) {
          stalled.status = 'timed_out';
          stalled.finishedAt = new Date();
          await this.runs.save(stalled);
          this.emitStatus(stalled, correlationId);
        }
        controller.abort();
      })();
    }, watchdogMs);

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
        await this.onStatusEvent(runId, payload, correlationId);
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
      clearTimeout(watchdog);
      this.abortControllers.delete(runId);
      await this.finalize(runId, testOutcomes, correlationId);
      this.activeRuns.delete(runId);
      void this.pump(correlationId);
    }
  }

  private async onStatusEvent(
    runId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const engineStatus = String(payload.status || '');
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || isTerminalExecutionStatus(run.status)) return;

    if (
      engineStatus === 'completed' ||
      engineStatus === 'error' ||
      engineStatus === 'cancelled' ||
      engineStatus === 'timed_out'
    ) {
      const metrics = (payload.metrics as Record<string, number>) || undefined;
      run.metrics = (payload.metrics as Record<string, unknown>) || run.metrics;
      run.finishedAt = new Date();
      // §23.7: map the engine outcome onto the explicit state machine.
      run.status =
        engineStatus === 'cancelled'
          ? 'cancelled'
          : engineStatus === 'timed_out'
            ? 'timed_out'
            : engineStatus === 'error'
              ? 'failed'
              : outcomeFromMetrics(metrics ?? (run.metrics as never) ?? {});
      await this.runs.save(run);
      this.emitStatus(run, correlationId, { metrics: run.metrics });
    } else if (engineStatus === 'running' && ['queued', 'preparing'].includes(run.status)) {
      run.startedAt = run.startedAt || new Date();
      await this.setStatus(run, 'running', correlationId);
    }
  }

  private async finalize(
    runId: string,
    testOutcomes: Map<string, string>,
    correlationId?: string,
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

    if (!isTerminalExecutionStatus(run.status)) {
      run.status =
        run.status === 'stopping'
          ? 'cancelled'
          : outcomeFromMetrics((run.metrics as never) ?? {});
      run.finishedAt = run.finishedAt || new Date();
      await this.runs.save(run);
      this.emitStatus(run, correlationId);
    }

    if (run.createdBy) {
      await this.notifications.notify({
        userId: run.createdBy,
        projectId: run.projectId,
        type: 'execution.finished',
        title: `Execution ${run.status.replace(/_/g, ' ')} (${run.browser}, ${run.headed ? 'headed' : 'headless'})`,
        message: summariseMetrics(run.metrics),
        resourceType: 'execution',
        resourceId: run.id,
        correlationId,
      });
    }
  }

  async getOne(id: string, user: AuthUser): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundAppException(`Execution ${id} not found`);
    await this.membership.ensureMember(run.projectId, user);
    return run;
  }

  async listByProject(projectId: string, user: AuthUser): Promise<ExecutionRun[]> {
    await this.membership.ensureMember(projectId, user);
    return this.runs.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async getEvents(
    id: string,
    user: AuthUser,
    fromSeq = 0,
  ): Promise<ExecutionEvent[]> {
    const run = await this.getOne(id, user);
    const events = await this.execEvents.find({
      where: {
        executionRunId: id,
        ...(fromSeq ? { seq: MoreThan(fromSeq) } : {}),
      },
      order: { seq: 'ASC' },
      // Bounded response; clients page through long runs with ?fromSeq=
      // (same pattern as job logs).
      take: 5000,
    });
    // After a backend restart the in-memory seq counter starts over; prime it
    // from the persisted stream so live envelopes never reuse a seq that a
    // client already saw (FR-BE-004 reconnect resume).
    const last = events[events.length - 1];
    if (last) this.events.primeSeq(run.projectId, id, last.seq);
    return events;
  }

  /** Stop control (FR-V3-EXE-008): safe cancellation with evidence retained. */
  async cancel(id: string, user: AuthUser, correlationId?: string) {
    const run = await this.getOne(id, user);
    if (isTerminalExecutionStatus(run.status)) {
      throw new ConflictAppException(
        `Execution ${id} is already ${run.status}.`,
        'invalid_state_transition',
      );
    }
    const controller = this.abortControllers.get(id);

    if (run.status === 'queued') {
      run.status = 'cancelled';
      run.finishedAt = new Date();
      await this.runs.save(run);
      this.emitStatus(run, correlationId);
    } else {
      await this.setStatus(run, 'stopping', correlationId);
    }

    let cancelled = true;
    try {
      const res = await this.engine.cancelExecution(id, correlationId);
      cancelled = res.cancelled;
    } catch {
      cancelled = false;
    }
    if (run.status === 'stopping') {
      run.status = 'cancelled';
      run.finishedAt = new Date();
      await this.runs.save(run);
      this.emitStatus(run, correlationId);
    }
    if (controller) controller.abort();
    this.activeRuns.delete(id);
    void this.pump(correlationId);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'execution.cancel',
      resourceType: 'execution',
      resourceId: id,
      projectId: run.projectId,
      correlationId,
    });
    return { id, cancelled, status: run.status };
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

function summariseMetrics(metrics: Record<string, unknown> | null): string {
  if (!metrics) return '';
  const p = metrics.passed ?? 0;
  const f = metrics.failed ?? 0;
  const s = metrics.skipped ?? 0;
  return `passed ${p}, failed ${f}, skipped ${s}`;
}
