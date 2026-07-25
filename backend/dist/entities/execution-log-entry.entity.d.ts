import { ExecutionLogLevel } from '../common/enums';
export declare class ExecutionLogEntry {
    id: string;
    executionRunId: string;
    projectId: string;
    seq: number;
    stage: string;
    level: ExecutionLogLevel;
    message: string;
    progress: number | null;
    testCaseId: string;
    testName: string;
    meta: Record<string, unknown> | null;
    createdAt: Date;
}
