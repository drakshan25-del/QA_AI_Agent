import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisJobDto } from './dto/analysis.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';

@ApiTags('analysis')
@ApiBearerAuth()
@Controller()
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post('projects/:projectId/analysis-jobs')
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAnalysisJobDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.analysis.createJob(
      projectId,
      dto,
      user,
      correlationId,
      idempotencyKey,
    );
  }

  @Get('projects/:projectId/analyses')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.analysis.listByProject(projectId, user);
  }

  @Get('analyses/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.analysis.getOne(id, user);
  }
}
