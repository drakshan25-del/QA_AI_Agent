import { ApprovalDecision } from '../../../common/enums';
export declare class ApprovalDto {
    decision: ApprovalDecision;
    comment?: string;
}
export declare class BulkApprovalDto {
    ids: string[];
    decision: ApprovalDecision;
    comment?: string;
}
