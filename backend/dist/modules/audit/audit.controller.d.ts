import { AuditService } from './audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { AuthUser } from '../../common/decorators';
export declare class AuditController {
    private readonly audit;
    private readonly membership;
    constructor(audit: AuditService, membership: MembershipService);
    list(user: AuthUser, actor?: string, action?: string, resourceType?: string, resourceId?: string, projectId?: string, from?: string, to?: string, limit?: string, offset?: string): Promise<{
        items: import("../../entities").AuditEvent[];
        total: number;
    }>;
}
