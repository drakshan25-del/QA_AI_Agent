import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CorrelationId, CurrentUser } from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';
import { NotFoundAppException } from '../../common/errors';
import { LocatorStorageService } from '../ui-scanner/locator-storage.service';
import { LocatorUsageService } from '../ui-scanner/locator-usage.service';
import { LocatorResolutionService } from './locator-resolution.service';
import {
  ResolveLocatorsBatchDto,
  ResolveLocatorsDto,
  ResolutionOptionsDto,
  RevalidateLocatorsDto,
} from './dto/locator-resolution.dto';
import { LocatorResolutionOptions } from './locator-resolution.types';

/**
 * Locator resolution API (FR-UIS-025 §16).
 *
 * Mounted under `projects/:projectId/locators`, alongside the UI Scanner's
 * locator library routes: the library is one resource, and resolution is a
 * read of it, so a caller never has to know which module owns what.
 *
 * Route order matters — `ProjectLocatorsController` (UI Scanner) registers
 * `locators` and `locators/history` first, so the `:locatorId` route here
 * cannot shadow them.
 */
@ApiTags('locators')
@ApiBearerAuth()
@Controller('projects/:projectId/locators')
@UseGuards(ProjectMemberGuard)
export class LocatorResolutionController {
  constructor(
    private readonly resolution: LocatorResolutionService,
    private readonly storage: LocatorStorageService,
    private readonly usage: LocatorUsageService,
  ) {}

  /** Resolve one test case (or an ad-hoc list of steps) to scanned locators. */
  @Post('resolve')
  @HttpCode(200)
  @RequirePermission('generation.run')
  async resolve(
    @Param('projectId') projectId: string,
    @Body() dto: ResolveLocatorsDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.resolution.resolveRequest(
      projectId,
      { testCaseId: dto.testCaseId, pageName: dto.pageName, steps: dto.steps },
      user,
      toOptions(dto, correlationId),
    );
  }

  /**
   * Resolve several test cases in one request — the preferred entry point
   * (§16): one library read, revalidation grouped by page across every case.
   */
  @Post('resolve-batch')
  @HttpCode(200)
  @RequirePermission('generation.run')
  async resolveBatch(
    @Param('projectId') projectId: string,
    @Body() dto: ResolveLocatorsBatchDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    const results = await this.resolution.resolveTestCases(
      projectId,
      dto.testCaseIds,
      user,
      toOptions(dto, correlationId),
    );
    return {
      results,
      resolvedCount: results.reduce((n, r) => n + r.resolvedSteps.length, 0),
      unresolvedCount: results.reduce((n, r) => n + r.unresolvedSteps.length, 0),
    };
  }

  /** Re-validate stored locators against the live application (§5). */
  @Post('revalidate')
  @HttpCode(200)
  @RequirePermission('artefact.edit')
  async revalidate(
    @Param('projectId') projectId: string,
    @Body() dto: RevalidateLocatorsDto,
    @CorrelationId() correlationId: string,
  ) {
    const results = await this.resolution.revalidateLocators(
      projectId,
      dto.locatorIds,
      { auth: dto.auth, correlationId },
    );
    return { results };
  }

  @Get(':locatorId')
  async getOne(
    @Param('projectId') projectId: string,
    @Param('locatorId') locatorId: string,
  ) {
    const locator = await this.storage.findById(projectId, locatorId);
    if (!locator) {
      throw new NotFoundAppException(
        `Locator ${locatorId} not found in this project`,
      );
    }
    return locator;
  }

  /** Where a locator is used and how it has behaved when executed (§15). */
  @Get(':locatorId/usage')
  async getUsage(
    @Param('projectId') projectId: string,
    @Param('locatorId') locatorId: string,
  ) {
    const usage = await this.usage.usageOf(projectId, locatorId);
    if (!usage) {
      throw new NotFoundAppException(
        `Locator ${locatorId} not found in this project`,
      );
    }
    return usage;
  }
}

function toOptions(
  dto: ResolutionOptionsDto,
  correlationId: string,
): LocatorResolutionOptions {
  return {
    revalidate: dto.revalidate,
    allowTargetedRescan: dto.allowTargetedRescan,
    allowLlmMatching: dto.allowLlmMatching,
    minMatchConfidence: dto.minMatchConfidence,
    minLocatorConfidence: dto.minLocatorConfidence,
    auth: dto.auth,
    correlationId,
  };
}
