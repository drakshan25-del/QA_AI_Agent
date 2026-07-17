import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import {
  AddMemberDto,
  CreateProjectDto,
  UpdateProjectDto,
} from './dto/project.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('qa_engineer', 'supervisor', 'admin', 'automation_engineer', 'devops')
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.projects.create(dto, user, correlationId);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.projects.findAllForUser(user);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projects.findOneWithSummary(id, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.projects.update(id, dto, user, correlationId);
  }

  @Get(':id/metrics')
  async metrics(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projects.metrics(id, user);
  }

  /** Project dashboard (FR-V3-ENT-003). */
  @Get(':id/dashboard')
  async dashboard(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projects.dashboard(id, user);
  }

  @Get(':id/export')
  async export(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projects.exportProject(id, user);
  }

  @Post(':id/members')
  @UseGuards(RolesGuard)
  @Roles('supervisor', 'admin')
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.projects.addMember(
      id,
      dto.userId,
      dto.projectRole || 'qa_engineer',
      user,
      correlationId,
    );
  }
}
