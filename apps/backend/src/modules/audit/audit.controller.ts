import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { isAdminRole } from '../../common/access/permissions';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { ForbiddenAppException } from '../../common/errors';

/** GET /audit — filter by actor/action/resource/project/date (FR-AUD-*, §15.2).
 *
 * Authorisation (FR-AUD-004 "authorised user"): admins may search the global
 * trail; every other role must scope the query to a project they are a
 * member of. Without this, any viewer could read cross-project audit data.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!isAdminRole(user.role)) {
      if (!projectId) {
        throw new ForbiddenAppException(
          'Non-admin audit queries must be scoped with ?projectId=<project you belong to>',
        );
      }
      await this.membership.ensureMember(projectId, user);
    }
    return this.audit.query({
      actor,
      action,
      resourceType,
      resourceId,
      projectId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
