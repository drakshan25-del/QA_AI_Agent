import { ApprovalDecision, ApprovalResourceType } from '../common/enums';
export declare class Approval {
    id: string;
    projectId: string;
    resourceType: ApprovalResourceType;
    resourceId: string;
    resourceVersion: number;
    decision: ApprovalDecision;
    comment: string;
    invalidated: boolean;
    actorId: string | null;
    actor: string;
    createdAt: Date;
}
