import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Job, JobLogEntry } from '../../entities';
import { EventType, JobType, LogSeverity } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MembershipService } from '../../common/access/membership.service';
export interface CreateJobInput {
    projectId: string;
    type: JobType;
    correlationId?: string;
    idempotencyKey?: string;
    inputRefs?: Record<string, unknown>;
    createdBy?: string | null;
    retryOfJobId?: string | null;
}
export interface JobResult {
    resultRefs: Record<string, unknown>;
    readyEvent?: {
        type: EventType;
        payload: Record<string, unknown>;
    };
    warnings?: string[];
}
export interface JobLogInput {
    stage?: string;
    message: string;
    severity?: LogSeverity;
    progress?: number;
    meta?: Record<string, unknown>;
}
export interface JobContext {
    log(entry: JobLogInput): Promise<void>;
    isCancelled(): Promise<boolean>;
    checkpoint(): Promise<void>;
}
export declare class JobCancelledError extends Error {
    constructor();
}
export type JobWorker = (job: Job, ctx: JobContext) => Promise<JobResult>;
export type RetryHandler = (original: Job, user: AuthUser, correlationId?: string) => Promise<{
    jobId: string;
    status: string;
}>;
export declare class JobsService {
    private readonly repo;
    private readonly logs;
    private readonly events;
    private readonly notifications;
    private readonly config;
    private readonly membership;
    private readonly logger;
    private readonly logSeq;
    private readonly retryHandlers;
    constructor(repo: Repository<Job>, logs: Repository<JobLogEntry>, events: EventsService, notifications: NotificationsService, config: ConfigService, membership: MembershipService);
    registerRetryHandler(type: JobType, handler: RetryHandler): void;
    create(input: CreateJobInput): Promise<Job>;
    dispatch(job: Job, worker: JobWorker): void;
    log(job: Job, entry: JobLogInput): Promise<void>;
    private context;
    private setStatus;
    private execute;
    private notifyFinished;
    get(id: string, user?: AuthUser): Promise<Job>;
    listByProject(projectId: string): Promise<Job[]>;
    getLogs(id: string, fromSeq?: number, user?: AuthUser): Promise<JobLogEntry[]>;
    cancel(id: string, user: AuthUser): Promise<Job>;
    retry(id: string, user: AuthUser, correlationId?: string): Promise<{
        jobId: string;
        status: string;
        retryOfJobId: string;
    }>;
}
