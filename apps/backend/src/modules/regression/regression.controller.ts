import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RegressionService } from './regression.service';
import { CompareRegressionDto } from './dto/regression.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';

@ApiTags('regression')
@ApiBearerAuth()
@Controller()
export class RegressionController {
  constructor(private readonly regression: RegressionService) {}

  /** Synchronous baseline-vs-candidate comparison (stateless engine call — no job). */
  @Post('projects/:projectId/regression-comparisons')
  @RequirePermission('regression.compare')
  @UseGuards(ProjectMemberGuard)
  async compare(
    @Param('projectId') projectId: string,
    @Body() dto: CompareRegressionDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.regression.compare(projectId, dto, user, correlationId);
  }

  @Get('projects/:projectId/regression-comparisons')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.regression.listByProject(projectId, user);
  }

  @Get('regression-comparisons/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.regression.getOne(id, user);
  }

  /** Promote a run to the project's regression baseline (single-baseline invariant). */
  @Post('executions/:id/baseline')
  @RequirePermission('regression.compare')
  async promoteBaseline(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.regression.promoteBaseline(id, user, correlationId);
  }
}
