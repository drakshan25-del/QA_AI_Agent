import { LogSeverity } from '../common/enums';
export declare class JobLogEntry {
    id: string;
    jobId: string;
    projectId: string;
    seq: number;
    stage: string;
    message: string;
    severity: LogSeverity;
    progress: number | null;
    meta: Record<string, unknown> | null;
    createdAt: Date;
}
