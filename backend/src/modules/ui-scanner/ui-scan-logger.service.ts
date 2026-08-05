import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { UiScanLogEntry } from '../../entities';
import { UiScanStage } from '../../common/enums';
import { redact, redactText } from '../../common/redact';
import { EventsService } from '../events/events.service';

/** Level vocabulary of the UI-scan console (§4). */
export type UiScanLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'success';

export interface UiScanLogContext {
  scanId: string;
  projectId: string;
  correlationId?: string;
}

export interface UiScanLogInput {
  level?: UiScanLogLevel;
  stage?: UiScanStage;
  message: string;
  /** Determinate 0-100 progress when the stage reports one. */
  progress?: number | null;
  meta?: Record<string, unknown>;
}

/** Stage-aware logger bound to one scan. */
export interface ScopedUiScanLogger {
  stage(stage: UiScanStage, message?: string): Promise<void>;
  setStage(stage: UiScanStage): void;
  debug(message: string, extra?: Partial<UiScanLogInput>): Promise<void>;
  info(message: string, extra?: Partial<UiScanLogInput>): Promise<void>;
  warning(message: string, extra?: Partial<UiScanLogInput>): Promise<void>;
  error(message: string, extra?: Partial<UiScanLogInput>): Promise<void>;
  success(message: string, extra?: Partial<UiScanLogInput>): Promise<void>;
  readonly currentStage: UiScanStage;
}

/**
 * Real-time UI-scan logging (FR-UIS-004).
 *
 * Deliberately the same shape as `ExecutionLoggerService`: each line is
 * redacted, persisted to `ui_scan_log_entries` for replay, streamed to the
 * browser as a `ui_scan.log` envelope and mirrored to the NestJS logger. The
 * per-scan sequence is seeded from the database the first time it is used so a
 * backend restart mid-scan never reissues a `seq` a client has already seen.
 *
 * Every message goes through `redactText` and every meta object through
 * `redact`, so a password, token, cookie, authorization header or session id
 * can never reach the console, the database or the browser (§4, SEC-007).
 */
@Injectable()
export class UiScanLoggerService {
  private readonly logger = new Logger('UiScan');
  private readonly seqByScan = new Map<string, number>();
  private readonly seeded = new Set<string>();
  private readonly seeding = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(UiScanLogEntry)
    private readonly logs: Repository<UiScanLogEntry>,
    private readonly events: EventsService,
  ) {}

  forScan(ctx: UiScanLogContext): ScopedUiScanLogger {
    let stage: UiScanStage = 'QUEUED';
    // Arrow functions throughout, so the returned object closes over `this`
    // lexically instead of aliasing it.
    const emit = (
      level: UiScanLogLevel,
      message: string,
      extra?: Partial<UiScanLogInput>,
    ): Promise<void> =>
      this.write(ctx, {
        level,
        stage: extra?.stage ?? stage,
        message,
        progress: extra?.progress ?? null,
        meta: extra?.meta,
      });

    return {
      get currentStage() {
        return stage;
      },
      setStage: (next: UiScanStage) => {
        stage = next;
      },
      stage: (next: UiScanStage, message?: string) => {
        stage = next;
        return emit('info', message ?? next.replace(/_/g, ' ').toLowerCase());
      },
      debug: (m, extra) => emit('debug', m, extra),
      info: (m, extra) => emit('info', m, extra),
      warning: (m, extra) => emit('warning', m, extra),
      error: (m, extra) => emit('error', m, extra),
      success: (m, extra) => emit('success', m, extra),
    };
  }

  /** Persist + broadcast + mirror one log line. Never throws to the caller. */
  async write(ctx: UiScanLogContext, entry: UiScanLogInput): Promise<void> {
    const seq = await this.nextSeq(ctx.scanId);
    const level = entry.level ?? 'info';
    const stage = entry.stage ?? 'QUEUED';
    const message = redactText(entry.message || '');
    const meta = entry.meta ? (redact(entry.meta) as Record<string, unknown>) : null;
    const progress =
      entry.progress === null || entry.progress === undefined
        ? null
        : Math.max(0, Math.min(100, Math.round(entry.progress)));
    const ts = new Date().toISOString();

    try {
      await this.logs.save(
        this.logs.create({
          scanId: ctx.scanId,
          projectId: ctx.projectId,
          seq,
          stage,
          level,
          message,
          progress,
          meta,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `ui-scan log persist failed (scan ${ctx.scanId}): ${(err as Error).message}`,
      );
    }

    this.events.emit({
      type: 'ui_scan.log',
      projectId: ctx.projectId,
      correlationId: ctx.correlationId,
      payload: {
        scanId: ctx.scanId,
        seq,
        level,
        stage,
        message,
        progress,
        meta: meta ?? undefined,
        ts,
      },
    });

    const line = `[${ctx.scanId.slice(0, 8)}] [${stage}] ${message}`;
    if (level === 'error') this.logger.error(line);
    else if (level === 'warning') this.logger.warn(line);
    else if (level === 'debug') this.logger.debug(line);
    else this.logger.log(line);
  }

  /** Ordered persisted log lines for replay after refresh/reconnect. */
  async fetch(scanId: string, fromSeq = 0): Promise<UiScanLogEntry[]> {
    return this.logs.find({
      where: { scanId, ...(fromSeq ? { seq: MoreThan(fromSeq) } : {}) },
      order: { seq: 'ASC' },
      take: 5000,
    });
  }

  /** Drop the in-memory counter once a scan is finished (bounded memory). */
  release(scanId: string): void {
    this.seqByScan.delete(scanId);
    this.seeded.delete(scanId);
    this.seeding.delete(scanId);
  }

  private async nextSeq(scanId: string): Promise<number> {
    if (!this.seeded.has(scanId)) {
      let pending = this.seeding.get(scanId);
      if (!pending) {
        pending = (async () => {
          try {
            const last = await this.logs.findOne({
              where: { scanId },
              order: { seq: 'DESC' },
              select: { seq: true },
            });
            const base = last?.seq ?? 0;
            if ((this.seqByScan.get(scanId) ?? 0) < base) {
              this.seqByScan.set(scanId, base);
            }
          } finally {
            this.seeded.add(scanId);
            this.seeding.delete(scanId);
          }
        })();
        this.seeding.set(scanId, pending);
      }
      await pending;
    }
    const next = (this.seqByScan.get(scanId) ?? 0) + 1;
    this.seqByScan.set(scanId, next);
    return next;
  }
}
