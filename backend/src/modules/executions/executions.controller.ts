import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExecutionsService } from './executions.service';
import { CreateExecutionDto } from './dto/execution.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';
import { NotFoundAppException } from '../../common/errors';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  /** Run Execution (FR-V3-EXE-001): 202 + queued run that starts streaming. */
  @Post()
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
  @RequirePermission('execution.run')
  async create(
    @Body() dto: CreateExecutionDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.executions.create(dto, user, correlationId, idempotencyKey);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.executions.getOne(id, user);
  }

  @Get(':id/events')
  async events(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('fromSeq') fromSeq?: string,
  ) {
    return this.executions.getEvents(
      id,
      user,
      fromSeq ? parseInt(fromSeq, 10) : 0,
    );
  }

  @Get(':id/results')
  async results(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.executions.getResults(id, user);
  }

  /** Stop control (FR-V3-EXE-008). */
  @Post(':id/cancel')
  @RequirePermission('execution.control')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.executions.cancel(id, user, correlationId);
  }

  /** Restart control (FR-V3-EXE-008): new run with the same configuration. */
  @Post(':id/restart')
  @HttpCode(202)
  @RequirePermission('execution.run')
  async restart(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.executions.restart(id, user, correlationId);
  }

  @Get(':id/report')
  async report(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const report = await this.executions.getStoredReport(id, user);
    if (!report) {
      throw new NotFoundAppException(
        `No report generated for execution ${id}. POST /executions/${id}/report/generate first.`,
      );
    }
    return report;
  }
}

/** Project-scoped run history for the execution and report pages. */
@ApiTags('executions')
@ApiBearerAuth()
@Controller()
export class ProjectExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @UseGuards(ProjectMemberGuard)
  @Get('projects/:projectId/executions')
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.executions.listByProject(projectId, user);
  }
}
