import { Repository } from 'typeorm';
import { Analysis, GenerationRun, Project, Requirement, TestPlan, TestPlanRevision } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
import { EngineClient } from '../../engine/engine.client';
import { ApprovalDecision } from '../../common/enums';
import { GenerateTestPlanDto, UpdateTestPlanDto } from './dto/test-plan.dto';
export interface RevisionSectionDiff {
    section: string;
    change: 'added' | 'removed' | 'changed' | 'unchanged';
    from: unknown;
    to: unknown;
}
export declare class TestPlansService {
    private readonly plans;
    private readonly revisions;
    private readonly requirements;
    private readonly analyses;
    private readonly runs;
    private readonly projects;
    private readonly membership;
    private readonly audit;
    private readonly events;
    private readonly jobs;
    private readonly approvals;
    private readonly derivation;
    private readonly engine;
    constructor(plans: Repository<TestPlan>, revisions: Repository<TestPlanRevision>, requirements: Repository<Requirement>, analyses: Repository<Analysis>, runs: Repository<GenerationRun>, projects: Repository<Project>, membership: MembershipService, audit: AuditService, events: EventsService, jobs: JobsService, approvals: ApprovalsService, derivation: RequirementDerivationService, engine: EngineClient);
    generate(projectId: string, dto: GenerateTestPlanDto, user: AuthUser, correlationId?: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    private saveRevision;
    listByProject(projectId: string, user: AuthUser): Promise<(TestPlan & {
        artefactState: string;
    })[]>;
    getOne(id: string, user: AuthUser): Promise<TestPlan>;
    private withState;
    update(id: string, dto: UpdateTestPlanDto, user: AuthUser, correlationId?: string): Promise<TestPlan>;
    approve(id: string, decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        id: string;
        approvalStatus: import("../../common/enums").ApprovalStatus;
        version: number;
    }>;
    listRevisions(id: string, user: AuthUser): Promise<TestPlanRevision[]>;
    getRevision(id: string, version: number, user: AuthUser): Promise<TestPlanRevision>;
    compareRevisions(id: string, fromVersion: number, toVersion: number, user: AuthUser): Promise<{
        from: TestPlanRevision;
        to: TestPlanRevision;
        sections: RevisionSectionDiff[];
    }>;
    restoreRevision(id: string, version: number, user: AuthUser, correlationId?: string): Promise<TestPlan>;
    export(id: string, format: string, user: AuthUser): Promise<{
        contentType: string;
        filename: string;
        body: string | Buffer;
    }>;
}
