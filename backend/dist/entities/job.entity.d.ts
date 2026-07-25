import { JobStatus, JobType } from '../common/enums';
export declare class Job {
    id: string;
    projectId: string;
    type: JobType;
    status: JobStatus;
    progress: number;
    correlationId: string;
    idempotencyKey: string | null;
    inputRefs: Record<string, unknown> | null;
    resultRefs: Record<string, unknown> | null;
    error: string;
    cancelRequested: boolean;
    retryOfJobId: string | null;
    currentStage: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
