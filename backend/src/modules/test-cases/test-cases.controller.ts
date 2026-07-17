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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TestCasesService } from './test-cases.service';
import { GenerateTestCasesDto, UpdateTestCaseDto } from './dto/test-case.dto';
import { BulkApprovalDto } from '../approvals/dto/approval.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';

@ApiTags('test-cases')
@ApiBearerAuth()
@Controller()
export class TestCasesController {
  constructor(private readonly cases: TestCasesService) {}

  @Post('projects/:projectId/test-cases/generate')
  @HttpCode(202)
  @UseGuards(ProjectMemberGuard)
  async generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateTestCasesDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.cases.generate(projectId, dto, user, correlationId, idempotencyKey);
  }

  @Get('projects/:projectId/test-cases')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Query('source') source?: string,
    @Query('priority') priority?: string,
    @Query('type') type?: string,
    @Query('approval') approval?: string,
    @Query('automation') automation?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.cases.list(
      projectId,
      {
        source,
        priority,
        type,
        approval,
        automation,
        q,
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
      user,
    );
  }

  @Get('projects/:projectId/coverage')
  @UseGuards(ProjectMemberGuard)
  async coverage(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cases.coverage(projectId, user);
  }

  @Get('test-cases/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.cases.getOne(id, user);
  }

  @Patch('test-cases/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTestCaseDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.cases.update(id, dto, user, correlationId);
  }

  @Post('test-cases/approval')
  async approve(
    @Body() dto: BulkApprovalDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.cases.approve(
      dto.ids,
      dto.decision,
      dto.comment || '',
      user,
      correlationId,
    );
  }
}
