import { Repository } from 'typeorm';
import { Approval, GeneratedArtifact, TestCase, TestPlan } from '../../entities';
import { ApprovalDecision, ApprovalResourceType, ApprovalStatus } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
interface ApprovableEntity {
    id: string;
    projectId: string;
    version: number;
    approvalStatus: ApprovalStatus;
    approvalInvalidated: boolean;
}
export declare class ApprovalsService {
    private readonly approvals;
    private readonly testPlans;
    private readonly testCases;
    private readonly artifacts;
    private readonly audit;
    private readonly events;
    private readonly logger;
    constructor(approvals: Repository<Approval>, testPlans: Repository<TestPlan>, testCases: Repository<TestCase>, artifacts: Repository<GeneratedArtifact>, audit: AuditService, events: EventsService);
    private repoFor;
    recordStandalone(type: Extract<ApprovalResourceType, 'validation_exception' | 'report'>, resourceId: string, projectId: string, decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<Approval>;
    latestStandalone(type: Extract<ApprovalResourceType, 'validation_exception' | 'report'>, resourceId: string): Promise<Approval | null>;
    private load;
    decide(type: ApprovalResourceType, id: string, decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        id: string;
        approvalStatus: ApprovalStatus;
        version: number;
    }>;
    decideBulk(type: ApprovalResourceType, ids: string[], decision: ApprovalDecision, comment: string, user: AuthUser, correlationId?: string): Promise<{
        id: string;
        approvalStatus?: ApprovalStatus;
        version?: number;
        error?: string;
    }[]>;
    ensureApproved(type: ApprovalResourceType, id: string): Promise<ApprovableEntity>;
    onUpstreamModified(type: ApprovalResourceType, id: string, user: AuthUser, correlationId?: string): Promise<void>;
    private invalidateDownstream;
    private markApprovalsInvalidated;
    private emitInvalidated;
    history(resourceId: string): Promise<Approval[]>;
    listByIds(ids: string[]): Promise<Approval[]>;
}
export {};
