import { Response } from 'express';
import { TestPlansService } from './test-plans.service';
import { GenerateTestPlanDto, UpdateTestPlanDto } from './dto/test-plan.dto';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import { AuthUser } from '../../common/decorators';
export declare class TestPlansController {
    private readonly plans;
    constructor(plans: TestPlansService);
    generate(projectId: string, dto: GenerateTestPlanDto, user: AuthUser, correlationId: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    list(projectId: string, user: AuthUser): Promise<(import("../../entities").TestPlan & {
        artefactState: string;
    })[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").TestPlan>;
    update(id: string, dto: UpdateTestPlanDto, user: AuthUser, correlationId: string): Promise<import("../../entities").TestPlan>;
    approval(id: string, dto: ApprovalDto, user: AuthUser, correlationId: string): Promise<{
        id: string;
        approvalStatus: import("../../common/enums").ApprovalStatus;
        version: number;
    }>;
    revisions(id: string, user: AuthUser): Promise<import("../../entities").TestPlanRevision[]>;
    compare(id: string, from: string, to: string, user: AuthUser): Promise<{
        from: import("../../entities").TestPlanRevision;
        to: import("../../entities").TestPlanRevision;
        sections: import("./test-plans.service").RevisionSectionDiff[];
    }>;
    revision(id: string, version: string, user: AuthUser): Promise<import("../../entities").TestPlanRevision>;
    restore(id: string, version: string, user: AuthUser, correlationId: string): Promise<import("../../entities").TestPlan>;
    export(id: string, format: string | undefined, user: AuthUser, res: Response): Promise<void>;
}
