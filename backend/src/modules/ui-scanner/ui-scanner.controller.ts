import {
  Body,
  Controller,
  Get,
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
import { ArtifactKind, UiScannerService } from './ui-scanner.service';
import { StartUiScanDto } from './dto/start-ui-scan.dto';
import {
  ApproveHighConfidenceDto,
  ApproveLocatorDto,
  ListLocatorsQueryDto,
  SaveLocatorsDto,
  UpdateLocatorDto,
  ValidateLocatorDto,
} from './dto/locator.dto';
import { UiScanArtifactsService } from './ui-scan-artifacts.service';
import { AuthUser, CorrelationId, CurrentUser } from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import { RequirePermission } from '../../common/access/permissions';

/**
 * UI Scanner API (FR-UIS-022).
 *
 * Every route is project-scoped and behind `ProjectMemberGuard`, so a scan id
 * alone is never enough to read another project's results; the service
 * re-checks that the scan actually belongs to the project in the path.
 *
 * Permissions follow the platform's existing split: running a scan is a
 * `generation.run` action, controlling one is `execution.control`, and
 * approving locators is an `artefact.edit` action.
 */
@ApiTags('ui-scanner')
@ApiBearerAuth()
@Controller('projects/:projectId/ui-scans')
@UseGuards(ProjectMemberGuard)
export class UiScannerController {
  constructor(private readonly scanner: UiScannerService) {}

  /** Start a scan (202 + a scan that begins streaming immediately). */
  @Post()
  @HttpCode(202)
  @RequirePermission('generation.run')
  async start(
    @Param('projectId') projectId: string,
    @Body() dto: StartUiScanDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.start(projectId, dto, user, correlationId);
  }

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scanner.listByProject(projectId, user);
  }

  /** Aggregate research metrics across the project's scans (§29). */
  @Get('metrics')
  async metrics(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scanner.projectMetrics(projectId, user);
  }

  @Get(':scanId')
  async get(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scanner.getOne(projectId, scanId, user);
  }

  @Post(':scanId/cancel')
  @RequirePermission('execution.control')
  async cancel(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.cancel(projectId, scanId, user, correlationId);
  }

  /** Re-run a finished scan with the same configuration. */
  @Post(':scanId/rescan')
  @HttpCode(202)
  @RequirePermission('generation.run')
  async rescan(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Body() dto: StartUiScanDto | undefined,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.rescan(projectId, scanId, dto, user, correlationId);
  }

  /** Persisted log replay for the console seed and reconnect gap. */
  @Get(':scanId/logs')
  async logs(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
    @Query('fromSeq') fromSeq?: string,
  ) {
    return this.scanner.getLogs(
      projectId,
      scanId,
      user,
      fromSeq ? parseInt(fromSeq, 10) : 0,
    );
  }

  @Get(':scanId/elements')
  async elements(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.scanner.getElements(projectId, scanId, user, { status, q });
  }

  @Get(':scanId/artifacts/screenshot')
  async screenshot(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendArtifact(projectId, scanId, user, 'screenshot', res);
  }

  @Get(':scanId/artifacts/accessibility')
  async accessibility(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendArtifact(projectId, scanId, user, 'accessibility', res);
  }

  private async sendArtifact(
    projectId: string,
    scanId: string,
    user: AuthUser,
    kind: ArtifactKind,
    res: Response,
  ): Promise<void> {
    const out = await this.scanner.getArtifact(projectId, scanId, user, kind);
    res.setHeader('Content-Type', out.contentType);
    // Inline for the screenshot viewer; the filename is the artefact's own
    // name, never a server path (§23).
    res.setHeader('Content-Disposition', `inline; filename="${out.filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(out.body);
  }

  /** Re-validate one element's locator against the live page. */
  @Post(':scanId/elements/:elementId/validate')
  @RequirePermission('artefact.edit')
  async validateElement(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Param('elementId') elementId: string,
    @Body() dto: ValidateLocatorDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.validateElementLocator(
      projectId,
      scanId,
      elementId,
      dto,
      user,
      correlationId,
    );
  }

  @Patch(':scanId/elements/:elementId/locator')
  @RequirePermission('artefact.edit')
  async updateLocator(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Param('elementId') elementId: string,
    @Body() dto: UpdateLocatorDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.updateElementLocator(
      projectId,
      scanId,
      elementId,
      dto,
      user,
      correlationId,
    );
  }

  @Post(':scanId/elements/:elementId/approve')
  @RequirePermission('artefact.edit')
  async approveElement(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Param('elementId') elementId: string,
    @Body() dto: ApproveLocatorDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.approveElement(
      projectId,
      scanId,
      elementId,
      dto,
      user,
      correlationId,
    );
  }

  @Post(':scanId/approve-high-confidence')
  @RequirePermission('artefact.edit')
  async approveHighConfidence(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Body() dto: ApproveHighConfidenceDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.approveHighConfidence(
      projectId,
      scanId,
      dto,
      user,
      correlationId,
    );
  }

  @Post(':scanId/save-locators')
  @RequirePermission('artefact.edit')
  async saveLocators(
    @Param('projectId') projectId: string,
    @Param('scanId') scanId: string,
    @Body() dto: SaveLocatorsDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.scanner.saveLocators(projectId, scanId, dto, user, correlationId);
  }
}

/** The project's locator library and its authentication-state options. */
@ApiTags('ui-scanner')
@ApiBearerAuth()
@Controller('projects/:projectId')
@UseGuards(ProjectMemberGuard)
export class ProjectLocatorsController {
  constructor(
    private readonly scanner: UiScannerService,
    private readonly artifacts: UiScanArtifactsService,
  ) {}

  @Get('locators')
  async list(
    @Param('projectId') projectId: string,
    @Query() query: ListLocatorsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scanner.listLocators(projectId, user, query);
  }

  /** Version history of one element's locators (§26 healing review). */
  @Get('locators/history')
  async history(
    @Param('projectId') projectId: string,
    @Query('elementKey') elementKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scanner.locatorHistory(projectId, user, elementKey);
  }

  /**
   * Authentication states available to this project. Only the ids are
   * returned — the contents are never exposed to the browser (§16).
   */
  @Get('ui-scan-storage-states')
  async storageStates(@Param('projectId') projectId: string) {
    const ids = await this.artifacts.listStorageStates(projectId);
    return ids.map((id) => ({ id, label: id }));
  }
}
