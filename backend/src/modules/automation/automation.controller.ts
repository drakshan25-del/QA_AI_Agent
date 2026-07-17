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
import { AutomationService } from './automation.service';
import { GenerateAutomationDto } from './dto/automation.dto';
import { ApprovalDto } from '../approvals/dto/approval.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('automation')
@ApiBearerAuth()
@Controller()
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Post('projects/:projectId/automation/generate')
  @RequirePermission('generation.run')
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
  async generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateAutomationDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.automation.generate(
      projectId,
      dto,
      user,
      correlationId,
      idempotencyKey,
    );
  }

  @Get('projects/:projectId/automation')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.automation.listByProject(projectId, user);
  }

  @Get('automation/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.automation.getOne(id, user);
  }

  /** Async validation job with live logs (FR-V3-LOG-005) → 202 {jobId}. */
  @Post('automation/:id/validate')
  @RequirePermission('generation.run')
  @HttpCode(202)
  async validate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.automation.validate(id, user, correlationId);
  }

  /** Governed validation exception (FR-V3-ENT-002, §23.3). */
  @Post('automation/:id/validation-override')
  @RequirePermission('approval.decide')
  async overrideValidation(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.automation.overrideValidation(
      id,
      body?.reason || '',
      user,
      correlationId,
    );
  }

  @Post('automation/:id/approval')
  @RequirePermission('approval.decide')
  async approval(
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.automation.approve(
      id,
      dto.decision,
      dto.comment || '',
      user,
      correlationId,
    );
  }

  @Get('automation/:id/execution-plan')
  async executionPlan(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.automation.executionPlan(id, user, correlationId);
  }
}
