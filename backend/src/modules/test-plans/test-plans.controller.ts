import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { TestPlansService } from './test-plans.service';
import { GenerateTestPlanDto, UpdateTestPlanDto } from './dto/test-plan.dto';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('test-plans')
@ApiBearerAuth()
@Controller()
export class TestPlansController {
  constructor(private readonly plans: TestPlansService) {}

  @Post('projects/:projectId/test-plans/generate')
  @RequirePermission('generation.run')
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
  async generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateTestPlanDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.plans.generate(projectId, dto, user, correlationId, idempotencyKey);
  }

  @Get('projects/:projectId/test-plans')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.plans.listByProject(projectId, user);
  }

  @Get('test-plans/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.plans.getOne(id, user);
  }

  @Patch('test-plans/:id')
  @RequirePermission('artefact.edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTestPlanDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.plans.update(id, dto, user, correlationId);
  }

  @Post('test-plans/:id/approval')
  @RequirePermission('approval.decide')
  async approval(
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.plans.approve(
      id,
      dto.decision,
      dto.comment || '',
      user,
      correlationId,
    );
  }

  /** Revision history v1, v2, v3 ... (FR-V3-TP-001/002). */
  @Get('test-plans/:id/revisions')
  async revisions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.plans.listRevisions(id, user);
  }

  /** Side-by-side comparison of two revisions (FR-V3-TP-003). */
  @Get('test-plans/:id/revisions/compare')
  async compare(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.plans.compareRevisions(
      id,
      parseInt(from, 10),
      parseInt(to, 10),
      user,
    );
  }

  @Get('test-plans/:id/revisions/:version')
  async revision(
    @Param('id') id: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.plans.getRevision(id, parseInt(version, 10), user);
  }

  /** Restore an older revision as a new latest revision (FR-V3-TP-003). */
  @Post('test-plans/:id/revisions/:version/restore')
  @RequirePermission('artefact.edit')
  async restore(
    @Param('id') id: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.plans.restoreRevision(
      id,
      parseInt(version, 10),
      user,
      correlationId,
    );
  }

  @Get('test-plans/:id/export')
  async export(
    @Param('id') id: string,
    @Query('format') format = 'md',
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.plans.export(id, format, user);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.body);
  }
}
