import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ExecutionLogEntry } from '../../entities';
import { ExecutionLogLevel, ExecutionStage } from '../../common/enums';
import { redact, redactText } from '../../common/redact';
import { EventsService } from '../events/events.service';

/** Identifies the run a log line belongs to (+ its trace correlation id). */
export interface ExecutionLogContext {
  runId: string;
  projectId: string;
  correlationId?: string;
}

/** One structured execution log line. */
export interface ExecutionLogInput {
  level?: ExecutionLogLevel;
  stage?: string;
  message: string;
  /** Determinate progress 0-100 (e.g. "test 5 of 28"); null when not measurable. */
  progress?: number | null;
  testCaseId?: string;
  testName?: string;
  /** Expandable technical detail (stack trace, evidence paths) — redacted. */
  meta?: Record<string, unknown>;
}

/**
 * A run-scoped logger with an ergonomic, CI-style API. Obtained from
 * `ExecutionLoggerService.forRun(ctx)`; keeps the current stage so callers
 * don't repeat it on every line. All methods persist + stream one entry.
 */
export interface ScopedExecutionLogger {
  /** Mark (and switch to) a new lifecycle stage, emitting an info line. */
  stage(stage: ExecutionStage, message?: string): Promise<void>;
  /** Switch the current stage silently (no log line). */
  setStage(stage: ExecutionStage): void;
  info(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  debug(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  warning(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  error(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  success(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  pass(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  fail(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
  /** Emit a determinate progress line (e.g. "Running test 5 of 28"). */
  progress(
    current: number,
    total: number,
    message: string,
    extra?: Partial<ExecutionLogInput>,
  ): Promise<void>;
  readonly currentStage: string;
}

/**
 * Real-time execution logging (§ live execution logs). Reusable, DI-injectable
 * service that mirrors the async-job logging subsystem (JobsService.log): each
 * line is redacted, persisted to `execution_log_entries` for replay, streamed
 * to the frontend as an `execution.log` WS envelope, and mirrored to the
 * NestJS `Logger` so backend debugging keeps working. Designed to be reused by
 * any future module that needs run-scoped, streamed logs — not just executions.
 */
@Injectable()
export class ExecutionLoggerService {
  private readonly logger = new Logger('Execution');
  /** Monotonic per-run log sequence (payload seq → client dedup/replay). */
  private readonly seqByRun = new Map<string, number>();
  /** Runs whose counter has been seeded from the DB (restart safety). */
  private readonly seeded = new Set<string>();
  private readonly seeding = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(ExecutionLogEntry)
    private readonly logs: Repository<ExecutionLogEntry>,
    private readonly events: EventsService,
  ) {}

  /** Return a stage-aware logger bound to one run. */
  forRun(ctx: ExecutionLogContext): ScopedExecutionLogger {
    let stage = '';
    const svc = this;
    const emit = (
      level: ExecutionLogLevel,
      message: string,
      extra?: Partial<ExecutionLogInput>,
    ) =>
      svc.write(ctx, {
        level,
        stage: extra?.stage ?? stage,
        message,
        progress: extra?.progress ?? null,
        testCaseId: extra?.testCaseId,
        testName: extra?.testName,
        meta: extra?.meta,
      });

    return {
      get currentStage() {
        return stage;
      },
      setStage(next: ExecutionStage) {
        stage = next;
      },
      stage(next: ExecutionStage, message?: string) {
        stage = next;
        return emit('info', message ?? next);
      },
      info: (m, extra) => emit('info', m, extra),
      debug: (m, extra) => emit('debug', m, extra),
      warning: (m, extra) => emit('warning', m, extra),
      error: (m, extra) => emit('error', m, extra),
      success: (m, extra) => emit('success', m, extra),
      pass: (m, extra) => emit('pass', m, extra),
      fail: (m, extra) => emit('fail', m, extra),
      progress: (current, total, message, extra) => {
        const pct =
          total > 0
            ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
            : null;
        return emit('info', message, { ...extra, progress: pct });
      },
    };
  }

  /** Persist + broadcast + mirror one log line. Never throws to the caller. */
  async write(ctx: ExecutionLogContext, entry: ExecutionLogInput): Promise<void> {
    const seq = await this.nextSeq(ctx.runId);
    const level = entry.level ?? 'info';
    const stage = entry.stage ?? '';
    const message = redactText(entry.message || '');
    const meta = entry.meta
      ? (redact(entry.meta) as Record<string, unknown>)
      : null;
    const progress =
      entry.progress === null || entry.progress === undefined
        ? null
        : Math.max(0, Math.min(100, Math.round(entry.progress)));
    const ts = new Date().toISOString();

    try {
      await this.logs.save(
        this.logs.create({
          executionRunId: ctx.runId,
          projectId: ctx.projectId,
          seq,
          stage,
          level,
          message,
          progress,
          testCaseId: entry.testCaseId ?? '',
          testName: entry.testName ?? '',
          meta,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `execution log persist failed (run ${ctx.runId}): ${(err as Error).message}`,
      );
    }

    this.events.emit({
      type: 'execution.log',
      projectId: ctx.projectId,
      runId: ctx.runId,
      correlationId: ctx.correlationId,
      payload: {
        runId: ctx.runId,
        seq,
        level,
        stage,
        message,
        progress,
        testCaseId: entry.testCaseId ?? '',
        testName: entry.testName ?? '',
        meta: meta ?? undefined,
        ts,
      },
    });

    // Mirror to the NestJS logger so the backend console still reflects the
    // run (req: keep NestJS logs for debugging) — one place, no console.log.
    const line = `[${ctx.runId.slice(0, 8)}]${stage ? ` [${stage}]` : ''} ${message}`;
    if (level === 'error' || level === 'fail') this.logger.error(line);
    else if (level === 'warning') this.logger.warn(line);
    else if (level === 'debug') this.logger.debug(line);
    else this.logger.log(line);
  }

  /** Ordered persisted log lines for replay after refresh/reconnect. */
  async fetch(runId: string, fromSeq = 0): Promise<ExecutionLogEntry[]> {
    return this.logs.find({
      where: { executionRunId: runId, ...(fromSeq ? { seq: MoreThan(fromSeq) } : {}) },
      order: { seq: 'ASC' },
      take: 5000,
    });
  }

  /** Drop the in-memory counter once a run is finished (bounded memory). */
  release(runId: string): void {
    this.seqByRun.delete(runId);
    this.seeded.delete(runId);
    this.seeding.delete(runId);
  }

  /** Next seq for a run, seeding from the DB once so a backend restart
   * mid-run never reuses a seq a client already saw. */
  private async nextSeq(runId: string): Promise<number> {
    if (!this.seeded.has(runId)) {
      let pending = this.seeding.get(runId);
      if (!pending) {
        pending = (async () => {
          try {
            const last = await this.logs.findOne({
              where: { executionRunId: runId },
              order: { seq: 'DESC' },
              select: { seq: true },
            });
            const base = last?.seq ?? 0;
            if ((this.seqByRun.get(runId) ?? 0) < base) {
              this.seqByRun.set(runId, base);
            }
          } finally {
            this.seeded.add(runId);
            this.seeding.delete(runId);
          }
        })();
        this.seeding.set(runId, pending);
      }
      await pending;
    }
    const next = (this.seqByRun.get(runId) ?? 0) + 1;
    this.seqByRun.set(runId, next);
    return next;
  }
}
