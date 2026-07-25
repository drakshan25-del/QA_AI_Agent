import { ApprovalStatus } from '../common/enums';
export declare class TestCase {
    id: string;
    projectId: string;
    generationRunId: string | null;
    requirementIds: string[] | null;
    caseKey: string;
    seq: number;
    humanId: string;
    title: string;
    objective: string;
    category: string;
    priority: string;
    preconditions: string[] | null;
    testData: Record<string, string> | null;
    steps: string[] | null;
    expectedResults: string[] | null;
    automationSuitability: string;
    source: string;
    approvalStatus: ApprovalStatus;
    approvalInvalidated: boolean;
    automationStatus: string;
    version: number;
    schemaVersion: string;
    contentHash: string;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
