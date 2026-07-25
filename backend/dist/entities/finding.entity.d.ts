import { FindingClassification } from '../common/enums';
export declare class Finding {
    id: string;
    projectId: string;
    executionRunId: string | null;
    testResultId: string | null;
    classification: FindingClassification;
    confidence: number;
    rationale: string;
    severity: string;
    overridden: boolean;
    overrideReason: string;
    defectDraft: Record<string, unknown> | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
