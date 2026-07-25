import { Repository } from 'typeorm';
import { GeneratedArtifact, GenerationRun, Project, TestCase } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { GenerateAutomationDto } from './dto/automation.dto';
export declare class AutomationService {
    private readonly artifacts;
    private readonly cases;
    private readonly runs;
    private readonly projects;
    private readonly membership;
    private readonly audit;
    private readonly events;
    private readonly jobs;
    private readonly approvals;
    private readonly engine;
    constructor(artifacts: Repository<GeneratedArtifact>, cases: Repository<TestCase>, runs: Repository<GenerationRun>, projects: Repository<Project>, membership: MembershipService, audit: AuditService, events: EventsService, jobs: JobsService, approvals: ApprovalsService, engine: EngineClient);
    generate(projectId: string, dto: GenerateAutomationDto, user: AuthUser, correlationId?: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    getOne(id: string, user: AuthUser): Promise<GeneratedArtifact>;
    updateContent(id: string, content: string, user: AuthUser, correlationId?: string): Promise<GeneratedArtifact>;
    listByProject(projectId: string, user: AuthUser): Promise<GeneratedArtifact[]>;
    validate(id: string, user: AuthUser, correlationId?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
        artifactId: string;
    }>;
    overrideValidation(id: string, reason: string, user: AuthUser, correlationId?: string): Promise<{
        artifactId: string;
        validationStatus: "overridden";
    }>;
    approve(id: string, decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        id: string;
        approvalStatus: import("../../common/enums").ApprovalStatus;
        version: number;
    }>;
    executionPlan(id: string, user: AuthUser, correlationId?: string): Promise<{
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
