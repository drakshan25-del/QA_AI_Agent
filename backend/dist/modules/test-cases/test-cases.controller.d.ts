import { TestCasesService } from './test-cases.service';
import { GenerateTestCasesDto, UpdateTestCaseDto } from './dto/test-case.dto';
import { BulkApprovalDto } from '../approvals/dto/approval.dto';
import { AuthUser } from '../../common/decorators';
export declare class TestCasesController {
    private readonly cases;
    constructor(cases: TestCasesService);
    generate(projectId: string, dto: GenerateTestCasesDto, user: AuthUser, correlationId: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    list(projectId: string, user: AuthUser, source?: string, priority?: string, type?: string, approval?: string, automation?: string, q?: string, page?: string, pageSize?: string): Promise<{
        items: import("../../entities").TestCase[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    coverage(projectId: string, user: AuthUser): Promise<Record<string, unknown>>;
    get(id: string, user: AuthUser): Promise<import("../../entities").TestCase>;
    update(id: string, dto: UpdateTestCaseDto, user: AuthUser, correlationId: string): Promise<import("../../entities").TestCase>;
    approve(dto: BulkApprovalDto, user: AuthUser, correlationId: string): Promise<{
        id: string;
        approvalStatus?: import("../../common/enums").ApprovalStatus;
        version?: number;
        error?: string;
    }[]>;
}
