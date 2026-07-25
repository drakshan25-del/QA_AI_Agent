import { OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Analysis, GenerationRun, Project, Requirement, TestCase } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
import { SequencesService } from '../sequences/sequences.service';
import { EngineClient } from '../../engine/engine.client';
import { GenerateTestCasesDto, UpdateTestCaseDto } from './dto/test-case.dto';
export interface TestCaseFilter {
    source?: string;
    priority?: string;
    type?: string;
    approval?: string;
    automation?: string;
    q?: string;
    page?: number;
    pageSize?: number;
}
export declare function formatTestCaseId(seq: number, zeroPad?: number): string;
export declare class TestCasesService implements OnModuleInit {
    private readonly cases;
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
    private readonly sequences;
    private readonly engine;
    private readonly logger;
    constructor(cases: Repository<TestCase>, requirements: Repository<Requirement>, analyses: Repository<Analysis>, runs: Repository<GenerationRun>, projects: Repository<Project>, membership: MembershipService, audit: AuditService, events: EventsService, jobs: JobsService, approvals: ApprovalsService, derivation: RequirementDerivationService, sequences: SequencesService, engine: EngineClient);
    onModuleInit(): Promise<void>;
    generate(projectId: string, dto: GenerateTestCasesDto, user: AuthUser, correlationId?: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
    }>;
    list(projectId: string, filter: TestCaseFilter, user: AuthUser): Promise<{
        items: TestCase[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    getOne(id: string, user: AuthUser): Promise<TestCase>;
    update(id: string, dto: UpdateTestCaseDto, user: AuthUser, correlationId?: string): Promise<TestCase>;
    approve(ids: string[], decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        id: string;
        approvalStatus?: import("../../common/enums").ApprovalStatus;
        version?: number;
        error?: string;
    }[]>;
    coverage(projectId: string, user: AuthUser): Promise<Record<string, unknown>>;
}
