import { ApprovalStatus, ArtifactStatus, ValidationStatus } from '../common/enums';
export declare class GeneratedArtifact {
    id: string;
    projectId: string;
    generationRunId: string | null;
    testCaseIds: string[] | null;
    path: string;
    kind: string;
    content: string;
    diff: string;
    traceability: Record<string, unknown> | null;
    contentHash: string;
    version: number;
    status: ArtifactStatus;
    supersededById: string | null;
    validationStatus: ValidationStatus;
    validationReport: Record<string, unknown> | null;
    approvalStatus: ApprovalStatus;
    approvalInvalidated: boolean;
    schemaVersion: string;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
