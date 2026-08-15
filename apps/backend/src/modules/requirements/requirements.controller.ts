import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirementsService } from './requirements.service';
import { CreateRequirementDto } from './dto/requirement.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';

@ApiTags('requirements')
@ApiBearerAuth()
@Controller()
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Post('projects/:projectId/requirements')
  @UseGuards(ProjectMemberGuard)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRequirementDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.requirements.create(projectId, dto, user, correlationId);
  }

  @Get('projects/:projectId/requirements')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requirements.listByProject(projectId, user);
  }

  @Get('requirements/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requirements.getOne(id, user);
  }

  @Get('requirements/:id/history')
  async history(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requirements.history(id, user);
  }

  @Get('requirements/:id/versions')
  async versions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requirements.versions(id, user);
  }
}
