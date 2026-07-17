import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { AuthUser } from '../decorators';

/**
 * Enforces project membership on project-scoped routes (V2_CONTRACT §1).
 * Resolves the project id from the `:projectId` route param or a `projectId`
 * body/query field; when none is present it defers (the resource-level service
 * performs its own scoping via {@link MembershipService.ensureMember} after
 * loading the resource). Admins bypass. Note: this guard never reads `:id`,
 * because on resource routes `:id` is the resource id, not a project id.
 */
@Injectable()
export class ProjectMemberGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) return false;

    const projectId: string | undefined =
      req.params?.projectId || req.body?.projectId || req.query?.projectId;

    if (!projectId) return true;
    await this.membership.ensureMember(projectId, user);
    return true;
  }
}
