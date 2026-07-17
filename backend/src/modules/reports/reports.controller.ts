import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
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

  @Post(':id/report/generate')
  async generate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.reports.generate(id, user, correlationId);
  }

  @Get(':id/report/export')
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
