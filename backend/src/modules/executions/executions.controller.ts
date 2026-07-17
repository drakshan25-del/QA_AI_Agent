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
import { NotFoundAppException } from '../../common/errors';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post()
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
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

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.executions.cancel(id, user, correlationId);
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
