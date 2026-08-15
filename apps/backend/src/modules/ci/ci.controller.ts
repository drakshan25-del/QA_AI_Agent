import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CiService } from './ci.service';
import { DispatchWorkflowDto } from './dto/ci.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('ci')
@ApiBearerAuth()
@Controller('ci')
export class CiController {
  constructor(private readonly ci: CiService) {}

  @Post('workflows/dispatch')
  @UseGuards(ProjectMemberGuard, RolesGuard)
  @Roles('devops', 'automation_engineer', 'supervisor', 'admin')
  async dispatch(
    @Body() dto: DispatchWorkflowDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.ci.dispatch(dto, user, correlationId);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ci.getRun(id, user);
  }

  /** CI run history for the project (FR-V3-CI-002). */
  @Get('projects/:projectId/runs')
  @UseGuards(ProjectMemberGuard)
  async listRuns(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ci.listRuns(projectId, user);
  }

  @Post('runs/:id/import')
  @RequirePermission('ci.trigger')
  async importRun(
    @Param('id') id: string,
    @Body() body: { metrics?: Record<string, unknown>; status?: string },
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.ci.importRun(id, body, user, correlationId);
  }
}
