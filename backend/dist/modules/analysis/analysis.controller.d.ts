import { AnalysisService } from './analysis.service';
import { CreateAnalysisJobDto } from './dto/analysis.dto';
import { AuthUser } from '../../common/decorators';
export declare class AnalysisController {
    private readonly analysis;
    constructor(analysis: AnalysisService);
    create(projectId: string, dto: CreateAnalysisJobDto, user: AuthUser, correlationId: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
        requirements: number;
    }>;
    list(projectId: string, user: AuthUser): Promise<import("../../entities").Analysis[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").Analysis>;
}
