import { ApprovalStatus } from '../common/enums';
export declare class TestPlanRevision {
    id: string;
    testPlanId: string;
    projectId: string;
    version: number;
    title: string;
    sections: Record<string, unknown>;
    contentHash: string;
    sourceAction: string;
    changeSummary: string;
    approvalStatus: ApprovalStatus;
    author: string;
    authorId: string | null;
    createdAt: Date;
}
