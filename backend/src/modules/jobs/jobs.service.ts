import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../../entities';
import { JobType, EventType } from '../../common/enums';
import { EventsService } from '../events/events.service';
import { NotFoundAppException } from '../../common/errors';

export interface CreateJobInput {
  projectId: string;
  type: JobType;
  correlationId?: string;
  idempotencyKey?: string;
  inputRefs?: Record<string, unknown>;
  createdBy?: string | null;
}

/** Result of a job worker: refs to persist + an optional domain-ready event. */
export interface JobResult {
  resultRefs: Record<string, unknown>;
  readyEvent?: { type: EventType; payload: Record<string, unknown> };
}

export type JobWorker = (job: Job) => Promise<JobResult>;

/**
 * Async job lifecycle (FR-BE-006, NFR-PERF-001). The controller creates a job
 * and dispatches a worker without awaiting it, so it can acknowledge within 2s
 * while the engine call and persistence continue in the background. Progress,
 * completion and failure are emitted as WS events.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(Job) private readonly repo: Repository<Job>,
    private readonly events: EventsService,
  ) {}

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
    });
    return this.repo.save(job);
  }

  /** Fire-and-forget execution of a job worker; never rejects to the caller. */
  dispatch(job: Job, worker: JobWorker): void {
    void this.execute(job, worker);
  }

  private async execute(job: Job, worker: JobWorker): Promise<void> {
    job.status = 'running';
    job.startedAt = new Date();
    job.progress = 10;
    await this.repo.save(job);
    this.events.emit({
      type: 'job.progress',
      projectId: job.projectId,
      jobId: job.id,
      correlationId: job.correlationId,
      payload: { jobId: job.id, type: job.type, status: 'running', progress: 10 },
    });

    try {
      const result = await worker(job);
      job.status = 'completed';
      job.progress = 100;
      job.finishedAt = new Date();
      job.resultRefs = result.resultRefs;
      await this.repo.save(job);

      this.events.emit({
        type: 'job.completed',
        projectId: job.projectId,
        jobId: job.id,
        correlationId: job.correlationId,
        payload: { jobId: job.id, type: job.type, resultRefs: result.resultRefs },
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
    } catch (err) {
      const message = (err as Error).message || 'job failed';
      this.logger.error(`job ${job.id} (${job.type}) failed: ${message}`);
      job.status = 'failed';
      job.finishedAt = new Date();
      job.error = message;
      await this.repo.save(job);
      this.events.emit({
        type: 'job.failed',
        projectId: job.projectId,
        jobId: job.id,
        correlationId: job.correlationId,
        payload: { jobId: job.id, type: job.type, error: message },
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
}
