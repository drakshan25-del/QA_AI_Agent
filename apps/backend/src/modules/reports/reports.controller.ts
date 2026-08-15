import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import { RequirePermission } from '../../common/access/permissions';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('executions')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Async report generation with live logs (FR-V3-LOG-006) → 202 {jobId}. */
  @Post(':id/report/generate')
  @HttpCode(202)
  async generate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.reports.generate(id, user, correlationId);
  }

  /** Report publication gate (FR-V3-ENT-002). */
  @Post(':id/report/approval')
  @RequirePermission('approval.decide')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.reports.decidePublication(
      id,
      dto.decision,
      dto.comment || '',
      user,
      correlationId,
    );
  }

  @Get(':id/report/export')
  @RequirePermission('report.export')
  async export(
    @Param('id') id: string,
    @Query('format') format = 'json',
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.reports.export(id, format, user);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.body);
  }
}
