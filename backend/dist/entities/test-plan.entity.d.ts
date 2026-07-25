import { ApprovalStatus } from '../common/enums';
export declare class TestPlan {
    id: string;
    projectId: string;
    generationRunId: string | null;
    title: string;
    version: number;
    approvalStatus: ApprovalStatus;
    approvalInvalidated: boolean;
    schemaVersion: string;
    contentHash: string;
    sections: Record<string, unknown>;
    model: string;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
