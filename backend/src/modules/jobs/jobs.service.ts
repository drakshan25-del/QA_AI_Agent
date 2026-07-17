import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Job, JobLogEntry } from '../../entities';
import {
  EventType,
  JobStatus,
  JobType,
  LogSeverity,
} from '../../common/enums';
import {
  JOB_TRANSITIONS,
  assertTransition,
  isTerminalJobStatus,
} from '../../common/state-machines';
import { AppConfig } from '../../config/configuration';
import { AuthUser } from '../../common/decorators';
import { redact, redactText } from '../../common/redact';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateJobInput {
  projectId: string;
  type: JobType;
  correlationId?: string;
  idempotencyKey?: string;
  inputRefs?: Record<string, unknown>;
  createdBy?: string | null;
  retryOfJobId?: string | null;
}

/** Result of a job worker: refs to persist + an optional domain-ready event. */
export interface JobResult {
  resultRefs: Record<string, unknown>;
  readyEvent?: { type: EventType; payload: Record<string, unknown> };
  /** Non-fatal issues → status `completed_with_warnings` (§23.7). */
  warnings?: string[];
}

export interface JobLogInput {
  stage?: string;
  message: string;
  severity?: LogSeverity;
  /** Determinate 0-100 progress when measurable (§23.1.1). */
  progress?: number;
  meta?: Record<string, unknown>;
}

/**
 * Live context handed to every worker (FR-V3-LOG-001..010): structured stage
 * logging and cooperative cancellation checkpoints.
 */
export interface JobContext {
  log(entry: JobLogInput): Promise<void>;
  isCancelled(): Promise<boolean>;
  /** Throws JobCancelledError when a cancel was requested (FR-V3-LOG-009). */
  checkpoint(): Promise<void>;
}

export class JobCancelledError extends Error {
  constructor() {
    super('Job cancelled by user request');
  }
}

export type JobWorker = (job: Job, ctx: JobContext) => Promise<JobResult>;

/**
 * A per-type handler that re-submits a job from its stored inputRefs
 * (FR-V3-LOG-009 Retry). Registered by each feature service at construction.
 */
export type RetryHandler = (
  original: Job,
  user: AuthUser,
  correlationId?: string,
) => Promise<{ jobId: string; status: string }>;

/**
 * Async job lifecycle (FR-BE-006, §23.7 state machine). The controller creates
 * a job and dispatches a worker without awaiting it (ack < 2s). Progress,
 * structured live logs, completion, failure, cancellation and timeout are
 * persisted and emitted as WS events; log replay is served from the DB so a
 * refreshed browser resumes without duplicates (FR-V3-LOG-008).
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly logSeq = new Map<string, number>();
  private readonly retryHandlers = new Map<JobType, RetryHandler>();

  constructor(
    @InjectRepository(Job) private readonly repo: Repository<Job>,
    @InjectRepository(JobLogEntry)
    private readonly logs: Repository<JobLogEntry>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  registerRetryHandler(type: JobType, handler: RetryHandler): void {
    this.retryHandlers.set(type, handler);
  }

  async create(input: CreateJobInput): Promise<Job> {
    if (input.idempotencyKey) {
      const existing = await this.repo.findOne({
        where: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing) return existing;
    }
    const job = this.repo.create({
      projectId: input.projectId,
      type: input.type,
      status: 'queued',
      progress: 0,
      correlationId: input.correlationId || '',
      idempotencyKey: input.idempotencyKey ?? null,
      inputRefs: input.inputRefs ?? null,
      createdBy: input.createdBy ?? null,
      retryOfJobId: input.retryOfJobId ?? null,
    });
    return this.repo.save(job);
  }

  /** Fire-and-forget execution of a job worker; never rejects to the caller. */
  dispatch(job: Job, worker: JobWorker): void {
    void this.execute(job, worker);
  }

  /** Persist + broadcast one structured live-log entry (FR-V3-LOG-007/010). */
  async log(job: Job, entry: JobLogInput): Promise<void> {
    const seq = (this.logSeq.get(job.id) ?? 0) + 1;
    this.logSeq.set(job.id, seq);
    const message = redactText(entry.message || '');
    const stage = entry.stage || job.currentStage || '';
    const severity = entry.severity || 'info';
    const meta = entry.meta ? (redact(entry.meta) as Record<string, unknown>) : null;

    try {
      await this.logs.save(
        this.logs.create({
          jobId: job.id,
          projectId: job.projectId,
          seq,
          stage,
          message,
          severity,
          progress: entry.progress ?? null,
          meta,
        }),
      );
      if (entry.stage || entry.progress !== undefined) {
        job.currentStage = stage;
        if (entry.progress !== undefined) {
          job.progress = Math.max(0, Math.min(100, Math.round(entry.progress)));
        }
        await this.repo.save(job);
      }
    } catch (err) {
      this.logger.warn(`job log persist failed: ${(err as Error).message}`);
    }

    this.events.emit({
      type: 'job.log',
      projectId: job.projectId,
      jobId: job.id,
      correlationId: job.correlationId,
      payload: {
        jobId: job.id,
        type: job.type,
        seq,
        stage,
        message,
        severity,
        progress: entry.progress ?? null,
        meta: meta ?? undefined,
        ts: new Date().toISOString(),
      },
    });
  }

  private context(job: Job): JobContext {
    const isCancelled = async (): Promise<boolean> => {
      const fresh = await this.repo.findOne({
        where: { id: job.id },
        select: { id: true, cancelRequested: true },
      });
      return !!fresh?.cancelRequested;
    };
    return {
      log: (entry) => this.log(job, entry),
      isCancelled,
      checkpoint: async () => {
        if (await isCancelled()) throw new JobCancelledError();
      },
    };
  }

  private async setStatus(job: Job, to: JobStatus): Promise<void> {
    assertTransition(JOB_TRANSITIONS, 'job', job.status, to);
    job.status = to;
    await this.repo.save(job);
  }

  private async execute(job: Job, worker: JobWorker): Promise<void> {
    await this.setStatus(job, 'running');
    job.startedAt = new Date();
    job.progress = 5;
    await this.repo.save(job);
    this.events.emit({
      type: 'job.progress',
      projectId: job.projectId,
      jobId: job.id,
      correlationId: job.correlationId,
      payload: { jobId: job.id, type: job.type, status: 'running', progress: 5 },
    });
    await this.log(job, {
      stage: 'started',
      message: `${labelForType(job.type)} started`,
      progress: 5,
    });

    const timeoutMs =
      this.config.get<AppConfig['jobs']>('jobs')?.timeoutMs ?? 1_800_000;
    let settled = false;

    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new JobTimeoutError(timeoutMs)),
        timeoutMs,
      );
      // Do not keep the process alive for the timer alone.
      if (typeof t.unref === 'function') t.unref();
    });

    try {
      const result = await Promise.race([worker(job, this.context(job)), timeout]);
      settled = true;

      const hasWarnings = (result.warnings ?? []).length > 0;
      job.finishedAt = new Date();
      job.resultRefs = result.resultRefs;
      job.progress = 100;
      await this.setStatus(
        job,
        hasWarnings ? 'completed_with_warnings' : 'completed',
      );

      await this.log(job, {
        stage: 'completed',
        severity: hasWarnings ? 'warning' : 'success',
        message: hasWarnings
          ? `${labelForType(job.type)} completed with warnings: ${result.warnings!.join('; ')}`
          : `${labelForType(job.type)} completed`,
        progress: 100,
      });

      this.events.emit({
        type: 'job.completed',
        projectId: job.projectId,
        jobId: job.id,
        correlationId: job.correlationId,
        payload: {
          jobId: job.id,
          type: job.type,
          status: job.status,
          resultRefs: result.resultRefs,
          warnings: result.warnings ?? [],
        },
      });
      if (result.readyEvent) {
        this.events.emit({
          type: result.readyEvent.type,
          projectId: job.projectId,
          jobId: job.id,
          correlationId: job.correlationId,
          payload: result.readyEvent.payload,
        });
      }
      await this.notifyFinished(job, 'success');
    } catch (err) {
      if (settled) return; // late worker rejection after timeout already handled
      settled = true;

      if (err instanceof JobCancelledError) {
        job.finishedAt = new Date();
        await this.setStatus(job, 'cancelled');
        await this.log(job, {
          stage: 'cancelled',
          severity: 'warning',
          message: `${labelForType(job.type)} cancelled by user`,
        });
        this.events.emit({
          type: 'job.cancelled',
          projectId: job.projectId,
          jobId: job.id,
          correlationId: job.correlationId,
          payload: { jobId: job.id, type: job.type },
        });
        return;
      }

      const timedOut = err instanceof JobTimeoutError;
      const message = redactText((err as Error).message || 'job failed');
      this.logger.error(`job ${job.id} (${job.type}) failed: ${message}`);
      job.finishedAt = new Date();
      job.error = message;
      await this.setStatus(job, timedOut ? 'timed_out' : 'failed');
      await this.log(job, {
        stage: timedOut ? 'timed_out' : 'failed',
        severity: 'error',
        message,
      });
      this.events.emit({
        type: 'job.failed',
        projectId: job.projectId,
        jobId: job.id,
        correlationId: job.correlationId,
        payload: { jobId: job.id, type: job.type, status: job.status, error: message },
      });
      await this.notifyFinished(job, 'failure');
    } finally {
      this.logSeq.delete(job.id);
    }
  }

  private async notifyFinished(
    job: Job,
    outcome: 'success' | 'failure',
  ): Promise<void> {
    if (!job.createdBy) return;
    const label = labelForType(job.type);
    await this.notifications.notify({
      userId: job.createdBy,
      projectId: job.projectId,
      type: outcome === 'success' ? 'job.completed' : 'job.failed',
      title:
        outcome === 'success'
          ? `${label} finished (${job.status.replace(/_/g, ' ')})`
          : `${label} ${job.status === 'timed_out' ? 'timed out' : 'failed'}`,
      message: outcome === 'success' ? '' : job.error,
      resourceType: 'job',
      resourceId: job.id,
      correlationId: job.correlationId,
    });
    // Generation outputs enter a human approval gate (FR-V3-ENT-002).
    if (
      outcome === 'success' &&
      ['test_plan', 'test_cases', 'automation'].includes(job.type)
    ) {
      await this.notifications.notify({
        userId: job.createdBy,
        projectId: job.projectId,
        type: 'approval.requested',
        title: `${label} output is ready for review and approval`,
        resourceType: 'job',
        resourceId: job.id,
        correlationId: job.correlationId,
      });
    }
  }

  async get(id: string): Promise<Job> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw new NotFoundAppException(`Job ${id} not found`);
    return job;
  }

  async listByProject(projectId: string): Promise<Job[]> {
    return this.repo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /** Ordered persisted log entries for replay after refresh (FR-V3-LOG-008). */
  async getLogs(id: string, fromSeq = 0): Promise<JobLogEntry[]> {
    await this.get(id);
    return this.logs.find({
      where: { jobId: id, ...(fromSeq ? { seq: MoreThan(fromSeq) } : {}) },
      order: { seq: 'ASC' },
      take: 2000,
    });
  }

  /** Request cooperative cancellation (FR-V3-LOG-009). */
  async cancel(id: string, user: AuthUser): Promise<Job> {
    const job = await this.get(id);
    if (isTerminalJobStatus(job.status)) {
      throw new ConflictAppException(
        `Job ${id} is already ${job.status} and cannot be cancelled.`,
        'invalid_state_transition',
        { status: job.status },
      );
    }
    job.cancelRequested = true;
    await this.repo.save(job);
    await this.log(job, {
      stage: 'cancelling',
      severity: 'warning',
      message: `Cancellation requested by ${user.email}; the job stops at the next checkpoint.`,
    });
    if (job.status === 'queued') {
      // Not yet picked up — cancel immediately.
      job.finishedAt = new Date();
      await this.setStatus(job, 'cancelled');
      this.events.emit({
        type: 'job.cancelled',
        projectId: job.projectId,
        jobId: job.id,
        correlationId: job.correlationId,
        payload: { jobId: job.id, type: job.type },
      });
    }
    return this.get(id);
  }

  /** Create a traceable new attempt linked to the original job (FR-V3-LOG-009). */
  async retry(
    id: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ jobId: string; status: string; retryOfJobId: string }> {
    const job = await this.get(id);
    if (!isTerminalJobStatus(job.status)) {
      throw new ConflictAppException(
        `Job ${id} is still ${job.status}; only finished jobs can be retried.`,
        'invalid_state_transition',
        { status: job.status },
      );
    }
    const handler = this.retryHandlers.get(job.type);
    if (!handler) {
      throw new ConflictAppException(
        `Job type ${job.type} does not support retry.`,
        'retry_unsupported',
      );
    }
    const accepted = await handler(job, user, correlationId);
    // Link the new attempt to the original for auditability.
    await this.repo.update({ id: accepted.jobId }, { retryOfJobId: job.id });
    return { ...accepted, retryOfJobId: job.id };
  }

  /** Retention sweep hook (FR-V3-ENT-011). */
  async deleteLogsOlderThan(cutoff: Date): Promise<number> {
    const res = await this.logs
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff: cutoff.toISOString() })
      .execute();
    return res.affected ?? 0;
  }
}

class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Job exceeded the ${Math.round(timeoutMs / 60000)} minute limit and was timed out.`,
    );
  }
}

function labelForType(type: JobType): string {
  switch (type) {
    case 'analysis':
      return 'Requirement analysis';
    case 'test_plan':
      return 'Test plan generation';
    case 'test_cases':
      return 'Test case generation';
    case 'automation':
      return 'Automation code generation';
    case 'validation':
      return 'Automation validation';
    case 'report':
      return 'Report generation';
    default:
      return 'Job';
  }
}
