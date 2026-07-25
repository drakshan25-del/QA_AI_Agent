export declare class Analysis {
    id: string;
    projectId: string;
    requirementId: string | null;
    generationRunId: string | null;
    schemaVersion: string;
    contentHash: string;
    riskScore: number;
    output: Record<string, unknown>;
    model: string;
    temperature: number;
    createdBy: string | null;
    createdAt: Date;
}
