import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GitService } from './git.service';
import { GitCommitDto, GitPushDto } from './dto/git.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('git')
@ApiBearerAuth()
@Controller()
export class GitController {
  constructor(private readonly git: GitService) {}

  @Post('projects/:projectId/git/commit')
  @RequirePermission('git.push')
  @UseGuards(ProjectMemberGuard, RolesGuard)
  @Roles('automation_engineer', 'devops', 'supervisor', 'admin')
  async commit(
    @Param('projectId') projectId: string,
    @Body() dto: GitCommitDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.git.commit(projectId, dto, user, correlationId);
  }

  @Post('projects/:projectId/git/push')
  @RequirePermission('git.push')
  @UseGuards(ProjectMemberGuard, RolesGuard)
  @Roles('automation_engineer', 'devops', 'supervisor', 'admin')
  async push(
    @Param('projectId') projectId: string,
    @Body() dto: GitPushDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.git.push(projectId, dto, user, correlationId);
  }
}
