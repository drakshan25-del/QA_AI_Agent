import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FindingsService } from './findings.service';
import { ClassifyDto, OverrideFindingDto } from './dto/finding.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('findings')
@ApiBearerAuth()
@Controller()
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Post('results/:id/classify')
  async classify(
    @Param('id') id: string,
    @Body() dto: ClassifyDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.findings.classify(id, dto.context, user, correlationId);
  }

  @Post('findings/:id/override')
  @RequirePermission('classification.override')
  async override(
    @Param('id') id: string,
    @Body() dto: OverrideFindingDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.findings.override(
      id,
      dto.classification,
      dto.reason,
      user,
      correlationId,
    );
  }

  @Post('findings/:id/defect-draft')
  async defectDraft(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.findings.defectDraft(id, user, correlationId);
  }
}
