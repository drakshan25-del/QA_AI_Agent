import { CanActivate, ExecutionContext } from '@nestjs/common';
import { MembershipService } from './membership.service';
export declare class ProjectMemberGuard implements CanActivate {
    private readonly membership;
    constructor(membership: MembershipService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
