import { ExecutionMode, ExecutionStatus } from '../common/enums';
export declare class ExecutionRun {
    id: string;
    projectId: string;
    mode: ExecutionMode;
    status: ExecutionStatus;
    environment: string;
    browser: string;
    headed: boolean;
    automationIds: string[] | null;
    testPaths: string[] | null;
    runScope: string;
    settings: Record<string, unknown> | null;
    restartOfRunId: string | null;
    metrics: Record<string, unknown> | null;
    evidence: Record<string, unknown> | null;
    ciRunId: string;
    ciUrl: string;
    correlationId: string;
    report: Record<string, unknown> | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
