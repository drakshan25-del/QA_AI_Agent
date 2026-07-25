export declare class TestResult {
    id: string;
    executionRunId: string;
    testCaseId: string | null;
    nodeId: string;
    outcome: string;
    durationSeconds: number;
    errorMessage: string;
    evidence: Record<string, unknown> | null;
    createdAt: Date;
}
