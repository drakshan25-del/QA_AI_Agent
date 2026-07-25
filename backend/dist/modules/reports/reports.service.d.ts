import { Repository } from 'typeorm';
import { ExecutionRun, Finding, Project, TestResult } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { JobsService } from '../jobs/jobs.service';
import { EngineClient } from '../../engine/engine.client';
export interface ReportCounts {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
    flaky: number;
    notRun: number;
    passRate: number;
}
export declare class ReportsService {
    private readonly runs;
    private readonly results;
    private readonly projects;
    private readonly findings;
    private readonly membership;
    private readonly audit;
    private readonly approvals;
    private readonly jobs;
    private readonly engine;
    constructor(runs: Repository<ExecutionRun>, results: Repository<TestResult>, projects: Repository<Project>, findings: Repository<Finding>, membership: MembershipService, audit: AuditService, approvals: ApprovalsService, jobs: JobsService, engine: EngineClient);
    private loadRun;
    buildCounts(run: ExecutionRun, results: TestResult[]): ReportCounts;
    generate(id: string, user: AuthUser, correlationId?: string): Promise<{
        jobId: string;
        status: string;
        executionRunId: string;
    }>;
    decidePublication(id: string, decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        executionRunId: string;
        decision: ApprovalDecision;
    }>;
    export(id: string, format: string, user: AuthUser): Promise<{
        contentType: string;
        filename: string;
        body: string | Buffer;
    }>;
}
