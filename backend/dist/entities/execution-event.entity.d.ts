export declare class ExecutionEvent {
    id: string;
    executionRunId: string;
    projectId: string | null;
    seq: number;
    type: string;
    testCaseId: string;
    testName: string;
    sequence: number;
    actionType: string;
    target: string;
    valueSummary: string;
    status: string;
    currentUrl: string;
    elapsedMs: number;
    evidenceUri: string;
    ts: string;
    payload: Record<string, unknown> | null;
    createdAt: Date;
}
