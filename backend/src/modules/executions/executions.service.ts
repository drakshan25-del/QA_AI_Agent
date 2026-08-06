import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
import {
  ExecutionEvent,
  ExecutionLogEntry,
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
import {
  ExecutionLoggerService,
  ScopedExecutionLogger,
} from './execution-logger.service';

/** Per-run streaming state used to derive human log lines + progress. */
interface RunStreamState {
  /** Total tests to run (files up front; exact count once pytest collects). */
  total: number;
  completed: number;
  started: number;
  /** Run-elapsed (ms) when each test started, to derive per-test duration. */
  testStart: Map<string, number>;
  /** Most recent error text seen for a test, used as its failure reason. */
  lastError: Map<string, string>;
  /** True once the engine has reported its collected test count. */
  collected: boolean;
}

function browserLabel(b: string): string {
  if (b === 'chromium') return 'Chrome (Chromium)';
  if (b === 'firefox') return 'Firefox';
  if (b === 'webkit') return 'Safari (WebKit)';
  return b || 'chromium';
}

/** Readable test name from a pytest node id (path::Class::test → "test"). */
function prettyTest(nodeId: string): string {
  if (!nodeId) return 'test';
  const parts = nodeId.split('::');
  if (parts.length > 1) return parts.slice(1).join(' › ');
  return nodeId.split('/').pop() || nodeId;
}

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
  /** Stage-aware log stream per active run (real-time execution logs). */
  private readonly runLoggers = new Map<string, ScopedExecutionLogger>();
  /** Derived progress/duration state per active run. */
  private readonly runStreams = new Map<string, RunStreamState>();

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
    private readonly execLog: ExecutionLoggerService,
  ) {}

  /** Stage-aware logger bound to a run (cached so the stage persists across
   * create → start → stream → finalize). */
  private log(
    run: { id: string; projectId: string },
    correlationId?: string,
  ): ScopedExecutionLogger {
    let l = this.runLoggers.get(run.id);
    if (!l) {
      l = this.execLog.forRun({
        runId: run.id,
        projectId: run.projectId,
        correlationId,
      });
      this.runLoggers.set(run.id, l);
    }
    return l;
  }

  private forgetRun(runId: string): void {
    this.runLoggers.delete(runId);
    this.runStreams.delete(runId);
    this.execLog.release(runId);
  }

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

    const position = await this.queuedPosition(run.id);
    this.emitStatus(run, correlationId, { queued_position: position });

    // Opening lines of the live execution log (real-time execution logs).
    const log = this.log(run, correlationId);
    await log.stage(
      'Initializing',
      restartOfRunId
        ? `Restarting execution (new run ${run.id.slice(0, 8)}, same configuration).`
        : 'Execution request accepted.',
    );
    await log.info(`Browser: ${browserLabel(run.browser)}`);
    await log.info(`Mode: ${run.headed ? 'Headed (visible browser)' : 'Headless'}`);
    await log.info(`Scope: ${scope} · Environment: ${run.environment}`);
    await log.info(`Test targets: ${testPaths.length} file(s).`, {
      meta: { testPaths },
    });
    await log.info(
      position > 1
        ? `Queued at position ${position} — waiting for an available runner slot.`
        : 'Queued — starting as soon as a runner slot is free.',
      { progress: 0 },
    );

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

      const log = this.log(run, correlationId);
      const settings0 = (run.settings ?? {}) as unknown as EffectiveSettings;
      await log.stage('Preparing Execution', 'Starting execution…');
      await log.stage('Loading Configuration', 'Reading execution configuration…');
      await log.info(
        `Settings: timeout ${settings0.timeoutSeconds}s · retries ${settings0.retries} · ` +
          `workers ${settings0.workers}` +
          (settings0.slowMoMs ? ` · slow-mo ${settings0.slowMoMs}ms` : '') +
          ` · screenshots ${settings0.screenshotMode}` +
          (settings0.video ? ' · video on' : ''),
      );

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
      await log.info(`Prepared ${files.length} automation file(s) for the runner.`);

      await log.stage('Discovering Tests', 'Discovering Playwright test files…');
      await log.info(`Found ${run.testPaths?.length ?? 0} test file(s).`, {
        meta: { testPaths: run.testPaths ?? [] },
      });

      // Seed the derived progress/duration state for this run's stream.
      this.runStreams.set(run.id, {
        total: run.testPaths?.length ?? 0,
        completed: 0,
        started: 0,
        testStart: new Map(),
        lastError: new Map(),
        collected: false,
      });

      await log.stage(
        'Launching Browser',
        `Launching ${browserLabel(run.browser)} (${run.headed ? 'headed' : 'headless'})…`,
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
      await log.stage('Running Tests', 'Runner started — executing tests…');
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
      const log = this.log(run, correlationId);
      log.setStage('Failed');
      await log.error(`Execution failed to start: ${(err as Error).message}`, {
        meta: { stack: (err as Error).stack },
      });
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
      this.forgetRun(run.id);
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

      // Translate raw telemetry into human, CI-style log lines.
      await this.logEngineEvent(runId, projectId, type, payload, correlationId);

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

  /**
   * Turn one raw engine event (step/status telemetry) into a readable,
   * CI-style log line. Test-level pass/fail/skip, collection count, runtime
   * errors and progress are surfaced; noisy per-action steps are left to the
   * timeline. Terminal run status is logged once in `finalize`, not here, to
   * avoid duplicate "completed/failed" lines.
   */
  private async logEngineEvent(
    runId: string,
    projectId: string,
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const log = this.log({ id: runId, projectId }, correlationId);
    const state = this.runStreams.get(runId);
    const pct = (): number | null => {
      if (!state || state.total <= 0) return null;
      return Math.max(0, Math.min(100, Math.round((state.completed / state.total) * 100)));
    };

    if (type === 'execution.status') {
      // Non-terminal detail (e.g. "materialised N generated file(s)").
      const status = String(payload.status || '');
      if (['preparing', 'running'].includes(status) && payload.detail) {
        await log.debug(String(payload.detail));
      }
      return;
    }
    if (type !== 'execution.step') return;

    const action = String(payload.action_type || '');
    const status = String(payload.status || '');
    const name = prettyTest(String(payload.test_name || payload.test_case_id || ''));
    const testCaseId = String(payload.test_case_id || payload.test_name || '');
    const elapsedMs = Number(payload.elapsed_ms ?? 0);

    // pytest reported how many tests it collected → exact total + count line.
    if (action === 'collected') {
      const count = Number(payload.sequence ?? payload.target ?? 0);
      if (state) {
        state.total = count || state.total;
        state.collected = true;
      }
      log.setStage('Running Tests');
      await log.info(`Found ${count} test case(s).`, { stage: 'Discovering Tests' });
      return;
    }

    if (action === 'test') {
      if (status === 'running') {
        if (state) {
          state.started += 1;
          state.testStart.set(testCaseId, elapsedMs);
        }
        const idx = state?.started ?? 0;
        const total = state?.total ?? 0;
        await log.progress(
          idx,
          total,
          `Running test ${idx}${total ? ` of ${total}` : ''}: ${name}`,
          { testCaseId, testName: name },
        );
        return;
      }
      if (['passed', 'failed', 'skipped'].includes(status)) {
        if (state) state.completed += 1;
        const startedAt = state?.testStart.get(testCaseId);
        const durationMs =
          startedAt !== undefined ? Math.max(0, elapsedMs - startedAt) : undefined;
        const dur = durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : '';
        const meta: Record<string, unknown> = { testCaseId };
        if (durationMs !== undefined) meta.durationMs = durationMs;
        if (status === 'passed') {
          await log.pass(`${name} passed${dur}`, { testCaseId, testName: name, progress: pct(), meta });
        } else if (status === 'skipped') {
          await log.info(`${name} skipped`, { testCaseId, testName: name, progress: pct(), meta });
        } else {
          // pytest's own crash message is authoritative; only fall back to the
          // last runtime error scraped off the page when it is absent, so a
          // real assertion failure is never reported as unrelated page noise.
          const reason =
            String(payload.value_summary || '') || state?.lastError.get(testCaseId);
          if (reason) meta.reason = reason;
          await log.fail(`${name} failed${dur}${reason ? ` — ${reason}` : ''}`, {
            testCaseId,
            testName: name,
            progress: pct(),
            meta,
          });
        }
        return;
      }
      return;
    }

    // Runtime errors surfaced by page listeners (pageerror/console/network) or
    // a failing action — record the reason and stream it as an ERROR line.
    // `blocked` marks a request the domain allow-list guard aborted by design
    // (SEC-003): kept in the timeline as evidence, logged at debug so it never
    // masquerades as a defect or displaces the real failure reason.
    if (status === 'failed' || status === 'blocked') {
      const target = String(payload.target || '');
      const value = String(payload.value_summary || '');
      const detail = [target, value].filter(Boolean).join(' — ');
      if (detail) {
        if (status === 'blocked') {
          await log.debug(`blocked by domain allow-list: ${detail}`, {
            testCaseId,
            testName: name,
          });
        } else {
          if (state && testCaseId) state.lastError.set(testCaseId, target || detail);
          await log.error(detail, { testCaseId, testName: name });
        }
      }
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

    const log = this.log(run, correlationId);
    await log.stage(
      'Capturing Evidence',
      'Collecting screenshots, traces and videos…',
    );

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

    // Single terminal log line for the run (avoids double-logging: neither
    // onStatusEvent nor logEngineEvent emit terminal lines).
    await this.logTerminal(run, log);

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

    this.forgetRun(runId);
  }

  /** Emit the final Completed/Failed log line for a settled run. */
  private async logTerminal(
    run: ExecutionRun,
    log: ScopedExecutionLogger,
  ): Promise<void> {
    const metrics = (run.metrics ?? {}) as Record<string, unknown>;
    const summary = summariseMetrics(run.metrics);
    const err = metrics.error ? String(metrics.error) : '';
    const meta = err ? { error: err } : undefined;
    switch (run.status) {
      case 'passed':
        log.setStage('Completed');
        await log.success(`Execution completed successfully — ${summary}.`, {
          progress: 100,
        });
        break;
      case 'partially_passed':
        log.setStage('Completed');
        await log.warning(`Execution completed with failures — ${summary}.`, {
          progress: 100,
        });
        break;
      case 'failed':
        log.setStage('Failed');
        await log.fail(`Execution failed — ${summary}.`, { progress: 100, meta });
        break;
      case 'timed_out':
        log.setStage('Failed');
        await log.error('Execution timed out before completing.', {
          progress: 100,
          meta,
        });
        break;
      case 'cancelled':
        log.setStage('Failed');
        await log.warning('Execution cancelled.', { progress: 100 });
        break;
      default:
        log.setStage('Failed');
        await log.error(`Execution ended (${run.status}) — ${err || summary}.`, {
          progress: 100,
          meta,
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

  /** Ordered persisted execution log lines for replay after refresh/reconnect
   * (real-time execution logs). Dedup on the client is by `seq`. */
  async getLogs(
    id: string,
    user: AuthUser,
    fromSeq = 0,
  ): Promise<ExecutionLogEntry[]> {
    await this.getOne(id, user);
    return this.execLog.fetch(id, fromSeq);
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

    const log = this.log(run, correlationId);
    await log.warning(`Cancellation requested by ${user.email}.`);

    if (run.status === 'queued') {
      run.status = 'cancelled';
      run.finishedAt = new Date();
      await this.runs.save(run);
      this.emitStatus(run, correlationId);
      // A queued run never streams, so log the terminal line + clean up here.
      await this.logTerminal(run, log);
      this.forgetRun(id);
    } else {
      await this.setStatus(run, 'stopping', correlationId);
      await log.info('Stopping the runner and its browser…');
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
