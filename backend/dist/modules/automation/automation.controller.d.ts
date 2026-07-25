import { AutomationService } from './automation.service';
import { GenerateAutomationDto, UpdateAutomationDto } from './dto/automation.dto';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import { AuthUser } from '../../common/decorators';
export declare class AutomationController {
    private readonly automation;
    constructor(automation: AutomationService);
    generate(projectId: string, dto: GenerateAutomationDto, user: AuthUser, correlationId: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    list(projectId: string, user: AuthUser): Promise<import("../../entities").GeneratedArtifact[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").GeneratedArtifact>;
    update(id: string, dto: UpdateAutomationDto, user: AuthUser, correlationId: string): Promise<import("../../entities").GeneratedArtifact>;
    validate(id: string, user: AuthUser, correlationId: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
        artifactId: string;
    }>;
    overrideValidation(id: string, body: {
        reason?: string;
    }, user: AuthUser, correlationId: string): Promise<{
        artifactId: string;
        validationStatus: "overridden";
    }>;
    approval(id: string, dto: ApprovalDto, user: AuthUser, correlationId: string): Promise<{
        id: string;
        approvalStatus: import("../../common/enums").ApprovalStatus;
        version: number;
    }>;
    executionPlan(id: string, user: AuthUser, correlationId: string): Promise<{
        schemaVersion: string;
        plans: {
            testCaseId: string;
            caseKey: string;
            title: string;
            steps: {
                sequence: number;
                actionType: string;
                target: string;
                description: string;
                expected: string;
            }[];
        }[];
    }>;
}
