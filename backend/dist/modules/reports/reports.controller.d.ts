import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import { AuthUser } from '../../common/decorators';
export declare class ReportsController {
    private readonly reports;
    constructor(reports: ReportsService);
    generate(id: string, user: AuthUser, correlationId: string): Promise<{
        jobId: string;
        status: string;
        executionRunId: string;
    }>;
    approve(id: string, dto: ApprovalDto, user: AuthUser, correlationId: string): Promise<{
        executionRunId: string;
        decision: import("../../common/enums").ApprovalDecision;
    }>;
    export(id: string, format: string | undefined, user: AuthUser, res: Response): Promise<void>;
}
