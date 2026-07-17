import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs/:id')
  async get(@Param('id') id: string) {
    return this.jobs.get(id);
  }

  @UseGuards(ProjectMemberGuard)
  @Get('projects/:projectId/jobs')
  async list(@Param('projectId') projectId: string) {
    return this.jobs.listByProject(projectId);
  }
}
