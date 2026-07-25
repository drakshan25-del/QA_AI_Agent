import { Repository } from 'typeorm';
import { ExecutionRun, Finding, TestResult } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { FindingClassification } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
export declare class FindingsService {
    private readonly findings;
    private readonly results;
    private readonly runs;
    private readonly membership;
    private readonly audit;
    private readonly engine;
    constructor(findings: Repository<Finding>, results: Repository<TestResult>, runs: Repository<ExecutionRun>, membership: MembershipService, audit: AuditService, engine: EngineClient);
    private projectOfResult;
    classify(resultId: string, context: string | undefined, user: AuthUser, correlationId?: string): Promise<Finding>;
    getOne(id: string, user: AuthUser): Promise<Finding>;
    override(id: string, classification: FindingClassification, reason: string, user: AuthUser, correlationId?: string): Promise<Finding>;
    defectDraft(id: string, user: AuthUser, correlationId?: string): Promise<Record<string, unknown>>;
}
