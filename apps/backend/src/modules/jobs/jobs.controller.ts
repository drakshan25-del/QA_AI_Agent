import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.get(id, user);
  }

  /** Ordered persisted live-log entries for replay (FR-V3-LOG-008). */
  @Get('jobs/:id/logs')
  async logs(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('fromSeq') fromSeq?: string,
  ) {
    return this.jobs.getLogs(id, fromSeq ? parseInt(fromSeq, 10) : 0, user);
  }

  /** Cooperative cancel for eligible long-running jobs (FR-V3-LOG-009). */
  @Post('jobs/:id/cancel')
  @RequirePermission('generation.run')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.cancel(id, user);
  }

  /** Retry a finished job as a traceable new attempt (FR-V3-LOG-009). */
  @Post('jobs/:id/retry')
  @RequirePermission('generation.run')
  async retry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.jobs.retry(id, user, correlationId);
  }

  @UseGuards(ProjectMemberGuard)
  @Get('projects/:projectId/jobs')
  async list(@Param('projectId') projectId: string) {
    return this.jobs.listByProject(projectId);
  }
}
