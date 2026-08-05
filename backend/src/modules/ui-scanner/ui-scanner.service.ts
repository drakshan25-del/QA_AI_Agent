import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  LocatorRecord,
  Project,
  ScannedElement,
  UiScan,
  UiScanLogEntry,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  Browser,
  LocatorStatus,
  UI_SCAN_TERMINAL_STAGES,
  UiScanStage,
} from '../../common/enums';
import {
  ConflictAppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { UI_SCAN_TRANSITIONS, canTransition } from '../../common/state-machines';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MembershipService } from '../../common/access/membership.service';
import {
  EngineClient,
  EngineSseEvent,
  UiScanRequest,
  UiScanResult,
} from '../../engine/engine.client';
import {
  ApproveHighConfidenceDto,
  ApproveLocatorDto,
  ListLocatorsQueryDto,
  SaveLocatorsDto,
  UpdateLocatorDto,
  ValidateLocatorDto,
} from './dto/locator.dto';
import { StartUiScanDto } from './dto/start-ui-scan.dto';
import { LocatorStorageService } from './locator-storage.service';
import {
  normaliseLocatorData,
  renderExpression,
  renderPythonExpression,
} from './locator-expression';
import { UiScanArtifactsService } from './ui-scan-artifacts.service';
import {
  ScopedUiScanLogger,
  UiScanLoggerService,
  UiScanLogLevel,
} from './ui-scan-logger.service';
import {
  ALLOW_PRIVATE_NETWORK,
  DEFAULT_APPROVAL_CONFIDENCE,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_MAX_PAGES,
  DEFAULT_TIMEOUT_MS,
  MAX_GLOBAL_CONCURRENT_SCANS,
  MAX_MAX_ELEMENTS,
  MAX_MAX_PAGES,
  MAX_PROJECT_CONCURRENT_SCANS,
  MAX_SCANS_PER_MINUTE,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  STREAM_WATCHDOG_MARGIN_MS,
} from './ui-scanner.limits';
import { assertUrlIsSafe, parseAllowedHosts } from './url-safety';
import {
  LocatorCandidate,
  UiScanErrorDetail,
  UiScanMetrics,
} from './ui-scanner.types';

/** Artefacts the scan endpoint can serve. */
export type ArtifactKind = 'screenshot' | 'accessibility';

/**
 * UI Scanner orchestration (FR-UIS-001..029).
 *
 * The split follows the rest of the platform: this backend is the system of
 * record (scan lifecycle, elements, locators, artefacts, audit, streaming) and
 * the Python engine owns the browser. A scan therefore looks like an execution
 * run — accept, queue, submit to the engine, consume its ordered event stream,
 * persist the result — which is why the streaming and logging here deliberately
 * mirror `ExecutionsService`.
 *
 * Security posture, in one place:
 *  - the target URL is SSRF-checked here *and* in the engine (§23);
 *  - credentials are request-scoped: forwarded once, never persisted, never
 *    logged, never sent to a model (§16);
 *  - storage states are referenced by id and resolved inside the project's own
 *    directory — a filesystem path is never accepted from the browser;
 *  - artefacts are served by scan id after a membership check, so no backend
 *    path ever reaches the browser.
 */
@Injectable()
export class UiScannerService {
  private readonly logger = new Logger(UiScannerService.name);
  /** Scans currently streaming on this host (FR-UIS-023 concurrency). */
  private readonly activeScans = new Set<string>();
  private readonly activeByProject = new Map<string, number>();
  private readonly abortControllers = new Map<string, AbortController>();
  /** Start timestamps per project, for the per-minute rate limit. */
  private readonly recentStarts = new Map<string, number[]>();

  constructor(
    @InjectRepository(UiScan) private readonly scans: Repository<UiScan>,
    @InjectRepository(ScannedElement)
    private readonly elements: Repository<ScannedElement>,
    @InjectRepository(LocatorRecord)
    private readonly locators: Repository<LocatorRecord>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly engine: EngineClient,
    private readonly log: UiScanLoggerService,
    private readonly artifacts: UiScanArtifactsService,
    private readonly locatorStore: LocatorStorageService,
  ) {}

  // --- start ------------------------------------------------------------

  async start(
    projectId: string,
    dto: StartUiScanDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ id: string; status: UiScanStage; url: string }> {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    this.assertCapacity(projectId);
    this.assertRateLimit(projectId);

    const allowedHosts = parseAllowedHosts(project.allowedDomains);
    const safeTarget = await assertUrlIsSafe(dto.url, {
      allowedHosts,
      allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
    });
    if (dto.loginUrl) {
      await assertUrlIsSafe(dto.loginUrl, {
        allowedHosts,
        allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
      });
    }

    // Resolved by id inside the project's own directory — the browser never
    // supplies a path, and one project can never read another's session.
    const storageState = dto.storageStateId
      ? await this.artifacts.readStorageState(projectId, dto.storageStateId)
      : undefined;

    const browser = (dto.browser || 'chromium') as Browser;
    const timeoutMs = clamp(dto.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const maxElements = clamp(dto.maxElements ?? DEFAULT_MAX_ELEMENTS, 1, MAX_MAX_ELEMENTS);
    const maxPages = clamp(dto.maxPages ?? DEFAULT_MAX_PAGES, 1, MAX_MAX_PAGES);
    const authenticated = !!(dto.username && dto.password) || !!storageState;

    const scan = await this.scans.save(
      this.scans.create({
        projectId,
        createdBy: user.id,
        url: safeTarget.url,
        browser,
        headless: dto.headless ?? true,
        status: 'QUEUED',
        progress: 0,
        authenticated,
        selectedModel: project.llmModel || '',
        correlationId: correlationId || '',
        // Never store the credentials themselves — only that a sign-in was
        // requested, so the scan record stays safe to read and export (§16).
        options: {
          browser,
          headless: dto.headless ?? true,
          timeoutMs,
          maxElements,
          maxPages,
          includeHidden: !!dto.includeHidden,
          captureScreenshot: dto.captureScreenshot ?? true,
          captureAccessibility: dto.captureAccessibility ?? true,
          scanFrames: dto.scanFrames ?? true,
          useLlmFallback: dto.useLlmFallback ?? true,
          loginUrl: dto.loginUrl || '',
          storageStateId: dto.storageStateId || '',
          preScanActions: dto.preScanActions ?? [],
          authenticated,
        },
      }),
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ui_scan.start',
      resourceType: 'ui_scan',
      resourceId: scan.id,
      projectId,
      correlationId,
      metadata: {
        url: safeTarget.url,
        browser,
        headless: scan.headless,
        authenticated,
        model: project.llmModel || '',
      },
    });

    const scanLog = this.log.forScan({
      scanId: scan.id,
      projectId,
      correlationId,
    });
    await scanLog.stage('QUEUED', 'UI scan request accepted');
    await scanLog.info(`Target: ${safeTarget.url}`);
    await scanLog.info(
      `Browser: ${browserLabel(browser)} · ${scan.headless ? 'headless' : 'headed'}`,
    );
    await scanLog.info(
      `Limits: ${maxElements} elements · ${Math.round(timeoutMs / 1000)}s timeout` +
        `${dto.includeHidden ? ' · including hidden elements' : ''}`,
    );
    await scanLog.info(
      maxPages > 1
        ? `Crawl: up to ${maxPages} pages by following in-app links ` +
          '(sign-out, destructive and off-site links are never followed)'
        : 'Crawl: off — scanning only the target page',
    );
    await scanLog.info(
      authenticated
        ? 'Authentication: the scanner will sign in before scanning'
        : 'Authentication: none — scanning the page anonymously',
    );
    await scanLog.info(
      project.llmModel
        ? `Model for unresolved elements: ${project.llmModel}`
        : 'No project model is configured; the scan stays fully deterministic',
    );
    this.emitStatus(scan, 'QUEUED', 'Queued', correlationId);

    const request: UiScanRequest = {
      scanId: scan.id,
      url: safeTarget.url,
      browser,
      headless: scan.headless,
      timeoutMs,
      maxElements,
      maxPages,
      includeHidden: !!dto.includeHidden,
      captureScreenshot: dto.captureScreenshot ?? true,
      captureAccessibility: dto.captureAccessibility ?? true,
      scanFrames: dto.scanFrames ?? true,
      allowedHosts,
      allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
      preScanActions: (dto.preScanActions ?? []) as unknown as Record<string, unknown>[],
      loginUrl: dto.loginUrl,
      username: dto.username,
      password: dto.password,
      storageState,
      // The project's model, never a hard-coded default (§17).
      model: project.llmModel || '',
      temperature: project.llmTemperature,
      useLlmFallback: dto.useLlmFallback ?? true,
      correlationId,
    };

    this.claimSlot(scan.id, projectId);
    void this.runScan(scan, request, timeoutMs, correlationId);

    return { id: scan.id, status: scan.status, url: scan.url };
  }

  private assertCapacity(projectId: string): void {
    if (this.activeScans.size >= MAX_GLOBAL_CONCURRENT_SCANS) {
      throw new ConflictAppException(
        `The scanner is already running ${this.activeScans.size} scan(s), which is ` +
          `the configured limit. Wait for one to finish and try again.`,
        'ui_scan_capacity',
        { limit: MAX_GLOBAL_CONCURRENT_SCANS },
      );
    }
    if ((this.activeByProject.get(projectId) ?? 0) >= MAX_PROJECT_CONCURRENT_SCANS) {
      throw new ConflictAppException(
        'This project already has a UI scan running. Wait for it to finish or cancel it.',
        'ui_scan_capacity',
        { limit: MAX_PROJECT_CONCURRENT_SCANS },
      );
    }
  }

  private assertRateLimit(projectId: string): void {
    const now = Date.now();
    const recent = (this.recentStarts.get(projectId) ?? []).filter(
      (t) => now - t < 60_000,
    );
    if (recent.length >= MAX_SCANS_PER_MINUTE) {
      throw new ConflictAppException(
        `Too many scans started for this project in the last minute ` +
          `(limit ${MAX_SCANS_PER_MINUTE}). Try again shortly.`,
        'rate_limited',
      );
    }
    recent.push(now);
    this.recentStarts.set(projectId, recent);
  }

  private claimSlot(scanId: string, projectId: string): void {
    this.activeScans.add(scanId);
    this.activeByProject.set(projectId, (this.activeByProject.get(projectId) ?? 0) + 1);
  }

  private releaseSlot(scanId: string, projectId: string): void {
    this.activeScans.delete(scanId);
    const left = (this.activeByProject.get(projectId) ?? 1) - 1;
    if (left <= 0) this.activeByProject.delete(projectId);
    else this.activeByProject.set(projectId, left);
    this.log.release(scanId);
  }

  // --- run + stream -----------------------------------------------------

  private async runScan(
    scan: UiScan,
    request: UiScanRequest,
    timeoutMs: number,
    correlationId?: string,
  ): Promise<void> {
    const scanLog = this.log.forScan({
      scanId: scan.id,
      projectId: scan.projectId,
      correlationId,
    });
    try {
      scan.startedAt = new Date();
      await this.scans.save(scan);
      await this.engine.startUiScan(request, correlationId);
      await this.consumeStream(scan, scanLog, timeoutMs, correlationId);
    } catch (err) {
      const message = (err as Error).message || 'The scan could not be started';
      this.logger.error(`ui scan ${scan.id} failed to start: ${message}`);
      await scanLog.error(message);
      await this.settleFailure(
        scan,
        {
          code: 'UI_SCAN_ENGINE_UNAVAILABLE',
          message,
          scanId: scan.id,
          stage: scan.status,
          recoverable: true,
        },
        correlationId,
      );
      this.releaseSlot(scan.id, scan.projectId);
    }
  }

  /**
   * Consume the engine's ordered event stream, turning each envelope into a
   * persisted log line or a status change, then collect the result.
   *
   * A watchdog covers the case where the engine itself stalls: the scan is
   * settled as failed rather than holding its concurrency slot forever.
   */
  private async consumeStream(
    scan: UiScan,
    scanLog: ScopedUiScanLogger,
    timeoutMs: number,
    correlationId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(scan.id, controller);
    let finished = false;

    const watchdog = setTimeout(() => {
      void (async () => {
        if (finished) return;
        this.logger.warn(`ui scan ${scan.id} stalled; aborting the event stream`);
        try {
          await this.engine.cancelUiScan(scan.id, correlationId);
        } catch {
          // engine unreachable — settle locally regardless
        }
        controller.abort();
      })();
    }, timeoutMs + STREAM_WATCHDOG_MARGIN_MS);

    // Log and status envelopes go through one writer, so the persisted `seq`
    // matches the order the engine produced them in and the console replays
    // exactly what the live stream showed.
    const handler = async (event: EngineSseEvent): Promise<void> => {
      const payload = event.payload || {};
      if (event.type === 'ui_scan.log') {
        await this.log.write(
          { scanId: scan.id, projectId: scan.projectId, correlationId },
          {
            level: normaliseLevel(payload.level),
            stage: (payload.stage as UiScanStage) || scan.status,
            message: String(payload.message ?? ''),
            meta: (payload.meta as Record<string, unknown>) || undefined,
          },
        );
        return;
      }
      if (event.type === 'ui_scan.status') {
        await this.applyStageEvent(scan, payload, correlationId);
      }
    };

    try {
      await this.engine.streamRunEvents(scan.id, handler, {
        correlationId,
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn(
        `ui scan ${scan.id} event stream ended with error: ${(err as Error).message}`,
      );
    } finally {
      finished = true;
      clearTimeout(watchdog);
      this.abortControllers.delete(scan.id);
      try {
        await this.collectResult(scan, scanLog, correlationId);
      } catch (err) {
        this.logger.error(
          `ui scan ${scan.id} result collection failed: ${(err as Error).message}`,
        );
        await this.settleFailure(
          scan,
          {
            code: 'UI_SCAN_RESULT_UNAVAILABLE',
            message:
              'The scan finished but its result could not be collected from the engine.',
            scanId: scan.id,
            stage: 'SAVING_RESULTS',
            recoverable: true,
          },
          correlationId,
        );
      } finally {
        this.releaseSlot(scan.id, scan.projectId);
      }
    }
  }

  private async applyStageEvent(
    scan: UiScan,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const stage = String(payload.stage || '') as UiScanStage;
    if (!stage || !(stage in UI_SCAN_TRANSITIONS)) return;
    const fresh = await this.scans.findOne({ where: { id: scan.id } });
    if (!fresh) return;
    // A terminal scan never moves again; a backwards stage is dropped rather
    // than throwing, because an event stream must not 409.
    if (UI_SCAN_TERMINAL_STAGES.includes(fresh.status)) return;
    if (!canTransition(UI_SCAN_TRANSITIONS, fresh.status, stage)) {
      this.logger.debug(
        `ui scan ${scan.id}: ignoring out-of-order stage ${fresh.status} → ${stage}`,
      );
      return;
    }
    fresh.status = stage;
    fresh.progress = clamp(Number(payload.progress ?? fresh.progress), 0, 100);
    await this.scans.save(fresh);
    scan.status = fresh.status;
    scan.progress = fresh.progress;
    this.emitStatus(fresh, stage, String(payload.message ?? ''), correlationId);
  }

  /** Fetch and persist the finished scan's elements, artefacts and metrics. */
  private async collectResult(
    scan: UiScan,
    scanLog: ScopedUiScanLogger,
    correlationId?: string,
  ): Promise<void> {
    const fresh = await this.scans.findOne({ where: { id: scan.id } });
    if (!fresh) return;
    if (UI_SCAN_TERMINAL_STAGES.includes(fresh.status) && fresh.completedAt) {
      return; // already settled (cancelled before the stream closed)
    }

    const result: UiScanResult = await this.engine.getUiScanResult(
      scan.id,
      correlationId,
    );

    if (result.status === 'FAILED') {
      await this.settleFailure(
        fresh,
        {
          code: result.error?.code || 'UI_SCAN_FAILED',
          message: result.error?.message || 'The scan failed.',
          scanId: scan.id,
          stage: (result.error?.stage as UiScanStage) || 'FAILED',
          recoverable: result.error?.recoverable ?? true,
        },
        correlationId,
      );
      return;
    }

    await this.persistElements(fresh, result);

    fresh.screenshotFile = await this.artifacts.saveScreenshot(
      fresh.projectId,
      fresh.id,
      result.screenshotBase64 || '',
    );
    fresh.accessibilitySnapshotFile = await this.artifacts.saveAccessibilitySnapshot(
      fresh.projectId,
      fresh.id,
      result.accessibilitySnapshot || '',
    );

    const metrics = (result.metrics || {}) as unknown as UiScanMetrics;
    fresh.finalUrl = result.finalUrl || fresh.url;
    fresh.pageTitle = result.pageTitle || '';
    fresh.frames = (result.frames || []) as Record<string, unknown>[];
    fresh.frameCount = (result.frames || []).length;
    fresh.pageCount = Number(metricsPageCount(result)) || 1;
    fresh.warnings = result.warnings || [];
    fresh.warningCount = (result.warnings || []).length;
    fresh.errorCount = (result.errors || []).length;
    fresh.totalElements = result.elements.length;
    fresh.validLocatorCount = result.elements.filter(
      (e) => e.status === 'unique',
    ).length;
    fresh.unresolvedCount = fresh.totalElements - fresh.validLocatorCount;
    fresh.selectedModel = result.selectedModel || fresh.selectedModel;
    fresh.metrics = {
      ...metrics,
      scanDurationMs: result.durationMs,
      averageConfidence: averageConfidence(result),
    } as unknown as Record<string, unknown>;
    fresh.durationMs = result.durationMs;
    fresh.completedAt = new Date();
    fresh.progress = 100;
    fresh.status = result.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
    await this.scans.save(fresh);

    for (const warning of fresh.warnings) {
      await scanLog.warning(warning, { stage: fresh.status });
    }
    if (fresh.status === 'COMPLETED') {
      await scanLog.success(
        `UI scan completed: ${fresh.validLocatorCount} of ${fresh.totalElements} ` +
          `element(s) have a unique locator across ${fresh.frameCount} frame(s)`,
        { stage: 'COMPLETED', progress: 100 },
      );
    } else {
      await scanLog.warning('UI scan cancelled before completion', {
        stage: 'CANCELLED',
        progress: 100,
      });
    }
    this.emitStatus(fresh, fresh.status, 'Scan finished', correlationId);

    this.events.emit({
      type: 'ui_scan.ready',
      projectId: fresh.projectId,
      correlationId,
      payload: {
        scanId: fresh.id,
        status: fresh.status,
        totalElements: fresh.totalElements,
        validLocatorCount: fresh.validLocatorCount,
        unresolvedCount: fresh.unresolvedCount,
      },
    });

    if (fresh.createdBy) {
      await this.notifications.notify({
        userId: fresh.createdBy,
        projectId: fresh.projectId,
        type: 'job.completed',
        title: `UI scan ${fresh.status.toLowerCase()} — ${fresh.validLocatorCount}/${fresh.totalElements} unique locators`,
        message: fresh.finalUrl,
        resourceType: 'ui_scan',
        resourceId: fresh.id,
        correlationId,
      });
    }
  }

  private async persistElements(scan: UiScan, result: UiScanResult): Promise<void> {
    await this.elements.delete({ scanId: scan.id });
    const rows = result.elements.map((element) =>
      this.elements.create({
        scanId: scan.id,
        projectId: scan.projectId,
        elementKey: element.elementKey,
        tagName: element.tagName,
        role: element.inferredRole || '',
        explicitRole: element.explicitRole || '',
        accessibleName: element.accessibleName || '',
        accessibleNameSource: element.accessibleNameSource || '',
        visibleText: element.visibleText || '',
        attributes: {
          id: element.id,
          name: element.name,
          inputType: element.inputType,
          placeholder: element.placeholder,
          title: element.title,
          alt: element.alt,
          href: element.href,
          // A credential field's value never leaves the engine; this is empty
          // for those elements by construction (§7).
          value: element.value,
          testIds: element.testIds,
          classes: element.classes,
          ariaLabel: element.ariaLabel,
          ariaLabelledBy: element.ariaLabelledBy,
          ariaDescribedBy: element.ariaDescribedBy,
          ariaDescription: element.ariaDescription,
        },
        states: element.states,
        position: element.position,
        context: element.context,
        frame: element.frame,
        candidates: element.candidates as unknown as Record<string, unknown>[],
        recommendedLocatorId: element.recommendedLocatorId || '',
        status: (element.status as LocatorStatus) || 'needs_review',
        sensitive: !!element.sensitive,
        pageUrl: element.pageUrl || result.finalUrl,
        pageTitle: element.pageTitle || result.pageTitle,
      }),
    );
    // Chunked so a large scan does not build one enormous statement.
    for (let i = 0; i < rows.length; i += 100) {
      await this.elements.save(rows.slice(i, i + 100));
    }
  }

  private async settleFailure(
    scan: UiScan,
    detail: UiScanErrorDetail,
    correlationId?: string,
  ): Promise<void> {
    const fresh = (await this.scans.findOne({ where: { id: scan.id } })) ?? scan;
    if (UI_SCAN_TERMINAL_STAGES.includes(fresh.status) && fresh.completedAt) return;
    fresh.status = 'FAILED';
    fresh.progress = 100;
    fresh.errorMessage = detail.message;
    fresh.errorDetail = detail as unknown as Record<string, unknown>;
    fresh.completedAt = new Date();
    fresh.errorCount += 1;
    await this.scans.save(fresh);
    this.emitStatus(fresh, 'FAILED', detail.message, correlationId);
    this.events.emit({
      type: 'ui_scan.ready',
      projectId: fresh.projectId,
      correlationId,
      payload: { scanId: fresh.id, status: 'FAILED', error: detail },
    });
    if (fresh.createdBy) {
      await this.notifications.notify({
        userId: fresh.createdBy,
        projectId: fresh.projectId,
        type: 'job.failed',
        title: 'UI scan failed',
        message: detail.message,
        resourceType: 'ui_scan',
        resourceId: fresh.id,
        correlationId,
      });
    }
  }

  private emitStatus(
    scan: UiScan,
    stage: UiScanStage,
    message: string,
    correlationId?: string,
  ): void {
    this.events.emit({
      type: 'ui_scan.status',
      projectId: scan.projectId,
      correlationId,
      payload: {
        scanId: scan.id,
        projectId: scan.projectId,
        stage,
        progress: scan.progress,
        message,
        totalElements: scan.totalElements,
        validLocatorCount: scan.validLocatorCount,
        unresolvedCount: scan.unresolvedCount,
        frameCount: scan.frameCount,
        pageCount: scan.pageCount,
        warningCount: scan.warningCount,
        errorCount: scan.errorCount,
        startedAt: scan.startedAt?.toISOString() ?? null,
      },
    });
  }

  // --- control ----------------------------------------------------------

  async cancel(
    projectId: string,
    scanId: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ id: string; cancelled: boolean; status: UiScanStage }> {
    const scan = await this.getOne(projectId, scanId, user);
    if (UI_SCAN_TERMINAL_STAGES.includes(scan.status)) {
      throw new ConflictAppException(
        `This scan is already ${scan.status.toLowerCase()} and cannot be cancelled.`,
        'invalid_state_transition',
        { status: scan.status },
      );
    }
    scan.cancelRequested = true;
    await this.scans.save(scan);
    await this.log.write(
      { scanId: scan.id, projectId, correlationId },
      {
        level: 'warning',
        stage: scan.status,
        message: `Cancellation requested by ${user.email}; the scan stops at its next checkpoint.`,
      },
    );

    let cancelled = true;
    try {
      const res = await this.engine.cancelUiScan(scanId, correlationId);
      cancelled = res.cancelled;
    } catch {
      cancelled = false;
    }

    const fresh = (await this.scans.findOne({ where: { id: scanId } })) ?? scan;
    if (!UI_SCAN_TERMINAL_STAGES.includes(fresh.status)) {
      fresh.status = 'CANCELLED';
      fresh.progress = 100;
      fresh.completedAt = new Date();
      await this.scans.save(fresh);
      this.emitStatus(fresh, 'CANCELLED', 'Scan cancelled', correlationId);
    }
    this.abortControllers.get(scanId)?.abort();

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ui_scan.cancel',
      resourceType: 'ui_scan',
      resourceId: scanId,
      projectId,
      correlationId,
    });
    return { id: scanId, cancelled, status: fresh.status };
  }

  /** Re-run a finished scan with the same configuration (FR-UIS-002). */
  async rescan(
    projectId: string,
    scanId: string,
    dto: StartUiScanDto | undefined,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ id: string; status: UiScanStage; url: string }> {
    const original = await this.getOne(projectId, scanId, user);
    if (!UI_SCAN_TERMINAL_STAGES.includes(original.status)) {
      throw new ConflictAppException(
        'This scan is still running; cancel it before starting a new one.',
        'invalid_state_transition',
        { status: original.status },
      );
    }
    const options = (original.options ?? {}) as Record<string, unknown>;
    const started = await this.start(
      projectId,
      {
        url: dto?.url || original.url,
        browser: (dto?.browser || original.browser) as Browser,
        headless: dto?.headless ?? original.headless,
        timeoutMs: dto?.timeoutMs ?? (options.timeoutMs as number),
        maxElements: dto?.maxElements ?? (options.maxElements as number),
        maxPages: dto?.maxPages ?? (options.maxPages as number),
        includeHidden: dto?.includeHidden ?? (options.includeHidden as boolean),
        captureScreenshot:
          dto?.captureScreenshot ?? (options.captureScreenshot as boolean),
        captureAccessibility:
          dto?.captureAccessibility ?? (options.captureAccessibility as boolean),
        scanFrames: dto?.scanFrames ?? (options.scanFrames as boolean),
        useLlmFallback: dto?.useLlmFallback ?? (options.useLlmFallback as boolean),
        loginUrl: dto?.loginUrl ?? (options.loginUrl as string),
        // Credentials are never stored, so a re-scan of an authenticated page
        // needs them supplied again (§16).
        username: dto?.username,
        password: dto?.password,
        storageStateId: dto?.storageStateId ?? (options.storageStateId as string),
        preScanActions: dto?.preScanActions,
      },
      user,
      correlationId,
    );
    await this.scans.update({ id: started.id }, { rescanOfId: original.id });
    return started;
  }

  // --- reads ------------------------------------------------------------

  async listByProject(projectId: string, user: AuthUser): Promise<UiScan[]> {
    await this.membership.ensureMember(projectId, user);
    return this.scans.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async getOne(projectId: string, scanId: string, user: AuthUser): Promise<UiScan> {
    await this.membership.ensureMember(projectId, user);
    const scan = await this.scans.findOne({ where: { id: scanId } });
    // Scoped by project as well as id: a scan id from another project must
    // read as "not found", never as someone else's data.
    if (!scan || scan.projectId !== projectId) {
      throw new NotFoundAppException(`UI scan ${scanId} not found in this project`);
    }
    return scan;
  }

  async getLogs(
    projectId: string,
    scanId: string,
    user: AuthUser,
    fromSeq = 0,
  ): Promise<UiScanLogEntry[]> {
    await this.getOne(projectId, scanId, user);
    return this.log.fetch(scanId, fromSeq);
  }

  async getElements(
    projectId: string,
    scanId: string,
    user: AuthUser,
    filter: { status?: string; q?: string } = {},
  ): Promise<ScannedElement[]> {
    await this.getOne(projectId, scanId, user);
    const rows = await this.elements.find({
      where: { scanId, ...(filter.status ? { status: filter.status as LocatorStatus } : {}) },
      order: { createdAt: 'ASC' },
      take: 2000,
    });
    if (!filter.q) return rows;
    const needle = filter.q.toLowerCase();
    return rows.filter((r) =>
      [r.elementKey, r.accessibleName, r.visibleText, r.role, r.tagName]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }

  async getArtifact(
    projectId: string,
    scanId: string,
    user: AuthUser,
    kind: ArtifactKind,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const scan = await this.getOne(projectId, scanId, user);
    const file =
      kind === 'screenshot' ? scan.screenshotFile : scan.accessibilitySnapshotFile;
    if (!file) {
      throw new NotFoundAppException(
        kind === 'screenshot'
          ? 'This scan has no screenshot. Enable "Include page screenshot" and re-scan.'
          : 'This scan has no accessibility snapshot. Enable "Include accessibility snapshot" and re-scan.',
      );
    }
    const body = await this.artifacts.read(projectId, scanId, file);
    return {
      body,
      contentType: kind === 'screenshot' ? 'image/png' : 'text/yaml; charset=utf-8',
      filename: file,
    };
  }

  // --- element review ---------------------------------------------------

  private async getElement(
    projectId: string,
    scanId: string,
    elementId: string,
    user: AuthUser,
  ): Promise<{ scan: UiScan; element: ScannedElement }> {
    const scan = await this.getOne(projectId, scanId, user);
    const element = await this.elements.findOne({ where: { id: elementId } });
    if (!element || element.scanId !== scanId) {
      throw new NotFoundAppException(`Scanned element ${elementId} not found in this scan`);
    }
    return { scan, element };
  }

  /**
   * Re-validate one element's locator against the live page (FR-UIS-011).
   *
   * This opens a real browser again through the engine — the whole point is
   * that a locator's verdict comes from the application, never from a stored
   * guess. Credentials, if the page needs them, are supplied per request.
   */
  async validateElementLocator(
    projectId: string,
    scanId: string,
    elementId: string,
    dto: ValidateLocatorDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<ScannedElement> {
    const { scan, element } = await this.getElement(projectId, scanId, elementId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    const candidates = (element.candidates ?? []) as unknown as LocatorCandidate[];
    const candidate =
      candidates.find((c) => c.id === (dto.candidateId || element.recommendedLocatorId)) ??
      candidates[0];
    if (!candidate) {
      throw new ValidationFailedException(
        'This element has no locator candidate to validate.',
      );
    }

    const allowedHosts = parseAllowedHosts(project?.allowedDomains);
    const target = await assertUrlIsSafe(dto.url || element.pageUrl || scan.finalUrl || scan.url, {
      allowedHosts,
      allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
    });

    const outcome = await this.engine.validateUiLocators(
      {
        url: target.url,
        browser: scan.browser,
        headless: true,
        timeoutMs: (scan.options?.timeoutMs as number) ?? DEFAULT_TIMEOUT_MS,
        allowedHosts,
        allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
        loginUrl: dto.loginUrl,
        username: dto.username,
        password: dto.password,
        locators: [
          {
            id: candidate.id,
            locatorData: candidate.locatorData as unknown as Record<string, unknown>,
          },
        ],
      },
      correlationId,
    );
    const verdict = outcome.results[0];
    if (!verdict) {
      throw new ConflictAppException(
        'The engine returned no verdict for this locator.',
        'ui_scan_validation_failed',
      );
    }

    candidate.matchCount = verdict.matchCount;
    candidate.unique = verdict.unique;
    candidate.valid = verdict.valid;
    candidate.warnings = verdict.error ? [verdict.error] : candidate.warnings;
    element.candidates = candidates as unknown as Record<string, unknown>[];
    element.status = verdict.unique
      ? 'unique'
      : verdict.matchCount > 1
        ? 'multiple_matches'
        : 'invalid';
    const saved = await this.elements.save(element);

    await this.log.write(
      { scanId, projectId, correlationId },
      {
        level: verdict.unique ? 'success' : 'warning',
        stage: 'VALIDATING_LOCATORS',
        message:
          `Re-validated ${LocatorStorageService.elementNameOf(element)}: ` +
          `${verdict.matchCount} match(es) on ${target.url}`,
      },
    );
    return saved;
  }

  /** Replace an element's locator with a hand-edited one (FR-UIS-018). */
  async updateElementLocator(
    projectId: string,
    scanId: string,
    elementId: string,
    dto: UpdateLocatorDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<ScannedElement> {
    const { element } = await this.getElement(projectId, scanId, elementId, user);
    const locatorData = normaliseLocatorData(dto.locatorData);
    const candidates = (element.candidates ?? []) as unknown as LocatorCandidate[];
    const manual: LocatorCandidate = {
      id: `${element.elementKey}-manual-${candidates.length + 1}`,
      strategy: locatorData.strategy,
      expression: renderExpression(locatorData),
      pythonExpression: renderPythonExpression(locatorData),
      locatorData,
      baseScore: 0,
      finalScore: 0,
      // A hand-written locator carries no verdict until it is validated
      // against the page — never present an unverified edit as trustworthy.
      confidence: 0,
      matchCount: -1,
      unique: false,
      valid: false,
      reasons: [`Edited by ${user.email}`],
      warnings: ['Not validated yet — run "Test locator" to verify it'],
      source: 'manual',
    };
    element.candidates = [manual, ...candidates] as unknown as Record<string, unknown>[];
    element.recommendedLocatorId = manual.id;
    element.status = 'manually_edited';
    const saved = await this.elements.save(element);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ui_scan.locator.edit',
      resourceType: 'ui_scan_element',
      resourceId: elementId,
      projectId,
      correlationId,
      metadata: { scanId, strategy: locatorData.strategy },
    });
    return saved;
  }

  async approveElement(
    projectId: string,
    scanId: string,
    elementId: string,
    dto: ApproveLocatorDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<ScannedElement> {
    const { element } = await this.getElement(projectId, scanId, elementId, user);
    const approved = dto.approved ?? true;
    if (approved && dto.candidateId) {
      const candidates = (element.candidates ?? []) as unknown as LocatorCandidate[];
      if (!candidates.some((c) => c.id === dto.candidateId)) {
        throw new ValidationFailedException(
          `Candidate ${dto.candidateId} does not belong to this element.`,
        );
      }
      element.recommendedLocatorId = dto.candidateId;
    }
    element.status = approved ? 'approved' : 'rejected';
    const saved = await this.elements.save(element);
    await this.refreshApprovalCount(scanId);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: approved ? 'ui_scan.locator.approve' : 'ui_scan.locator.reject',
      resourceType: 'ui_scan_element',
      resourceId: elementId,
      projectId,
      correlationId,
      metadata: { scanId, candidateId: element.recommendedLocatorId },
    });
    return saved;
  }

  /** Approve every element whose recommended locator clears the bar (§18). */
  async approveHighConfidence(
    projectId: string,
    scanId: string,
    dto: ApproveHighConfidenceDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ approved: number; skipped: number; minConfidence: number }> {
    await this.getOne(projectId, scanId, user);
    const minConfidence = dto.minConfidence ?? DEFAULT_APPROVAL_CONFIDENCE;
    const uniqueOnly = dto.uniqueOnly ?? true;
    const rows = await this.elements.find({ where: { scanId } });

    let approved = 0;
    let skipped = 0;
    for (const element of rows) {
      if (element.status === 'approved') continue;
      const candidates = (element.candidates ?? []) as unknown as LocatorCandidate[];
      const best = candidates.find((c) => c.id === element.recommendedLocatorId);
      if (
        !best ||
        !best.valid ||
        best.confidence < minConfidence ||
        (uniqueOnly && !best.unique)
      ) {
        skipped += 1;
        continue;
      }
      element.status = 'approved';
      await this.elements.save(element);
      approved += 1;
    }
    await this.refreshApprovalCount(scanId);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ui_scan.locator.bulk_approve',
      resourceType: 'ui_scan',
      resourceId: scanId,
      projectId,
      correlationId,
      metadata: { approved, skipped, minConfidence, uniqueOnly },
    });
    return { approved, skipped, minConfidence };
  }

  /** Persist the approved locators into the project library (FR-UIS-021). */
  async saveLocators(
    projectId: string,
    scanId: string,
    dto: SaveLocatorsDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ saved: number; superseded: number }> {
    const scan = await this.getOne(projectId, scanId, user);
    const where = dto.elementIds?.length
      ? { scanId, id: In(dto.elementIds) }
      : { scanId, status: 'approved' as LocatorStatus };
    const elements = await this.elements.find({ where });
    if (!elements.length) {
      throw new ValidationFailedException(
        'No approved locators to save. Approve at least one element first.',
      );
    }
    const { saved, superseded } = await this.locatorStore.saveApproved(
      scan,
      elements,
      user,
      dto.pageName || '',
      correlationId,
    );
    await this.refreshApprovalCount(scanId);

    await this.log.write(
      { scanId, projectId, correlationId },
      {
        level: 'success',
        stage: scan.status,
        message:
          `${saved} locator(s) saved to the project library` +
          (superseded ? `, superseding ${superseded} previous version(s)` : ''),
      },
    );
    this.events.emit({
      type: 'ui_scan.ready',
      projectId,
      correlationId,
      payload: { scanId, savedLocators: saved, superseded },
    });
    return { saved, superseded };
  }

  private async refreshApprovalCount(scanId: string): Promise<void> {
    const approved = await this.elements.count({
      where: { scanId, status: 'approved' as LocatorStatus },
    });
    await this.scans.update({ id: scanId }, { approvedLocatorCount: approved });
  }

  // --- project locator library ------------------------------------------

  async listLocators(
    projectId: string,
    user: AuthUser,
    query: ListLocatorsQueryDto = {},
  ): Promise<LocatorRecord[]> {
    await this.membership.ensureMember(projectId, user);
    return this.locatorStore.listByProject(projectId, {
      pageUrlPattern: query.pageUrlPattern,
      elementName: query.elementName,
      approvedOnly: query.approvedOnly !== 'false',
      activeOnly: query.activeOnly !== 'false',
    });
  }

  async locatorHistory(
    projectId: string,
    user: AuthUser,
    elementKey: string,
  ): Promise<LocatorRecord[]> {
    await this.membership.ensureMember(projectId, user);
    return this.locatorStore.history(projectId, elementKey);
  }

  /** Aggregate research metrics across a project's scans (§29). */
  async projectMetrics(
    projectId: string,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.membership.ensureMember(projectId, user);
    const scans = await this.scans.find({
      where: { projectId, status: 'COMPLETED' as UiScanStage },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const approvedLocators = await this.locatorStore.countApproved(projectId);
    const totals = scans.reduce(
      (acc, scan) => {
        const metrics = (scan.metrics ?? {}) as Record<string, number>;
        acc.scans += 1;
        acc.elements += scan.totalElements;
        acc.unique += scan.validLocatorCount;
        acc.unresolved += scan.unresolvedCount;
        acc.durationMs += scan.durationMs ?? 0;
        acc.semantic += (metrics.semanticLocatorRate ?? 0) * scan.totalElements;
        acc.llmFallbacks += metrics.llmFallbackCount ?? 0;
        return acc;
      },
      {
        scans: 0,
        elements: 0,
        unique: 0,
        unresolved: 0,
        durationMs: 0,
        semantic: 0,
        llmFallbacks: 0,
      },
    );
    return {
      scans: totals.scans,
      totalElements: totals.elements,
      uniqueLocators: totals.unique,
      unresolvedElements: totals.unresolved,
      uniqueLocatorRate: ratio(totals.unique, totals.elements),
      semanticLocatorRate: ratio(totals.semantic, totals.elements),
      llmFallbackRate: ratio(totals.llmFallbacks, totals.elements),
      averageScanDurationMs: totals.scans
        ? Math.round(totals.durationMs / totals.scans)
        : 0,
      approvedLocators,
      locatorApprovalRate: ratio(approvedLocators, totals.unique),
    };
  }

  /** Scans still streaming, exposed for the health endpoint and tests. */
  get activeScanCount(): number {
    return this.activeScans.size;
  }
}

/** Pages the engine reported scanning, defaulting to a single page. */
function metricsPageCount(result: UiScanResult): number {
  const metrics = (result.metrics || {}) as Record<string, unknown>;
  const pages = Number(metrics.pagesScanned);
  return Number.isFinite(pages) && pages > 0 ? pages : 1;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? Number((part / whole).toFixed(4)) : 0;
}

function browserLabel(browser: string): string {
  if (browser === 'chromium') return 'Chrome (Chromium)';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'webkit') return 'Safari (WebKit)';
  return browser;
}

function normaliseLevel(level: unknown): UiScanLogLevel {
  const value = String(level ?? 'info').toLowerCase();
  return (['debug', 'info', 'warning', 'error', 'success'] as const).includes(
    value as UiScanLogLevel,
  )
    ? (value as UiScanLogLevel)
    : 'info';
}

function averageConfidence(result: UiScanResult): number {
  const confidences = result.elements
    .map((element) => {
      const best = element.candidates?.find(
        (c) => c.id === element.recommendedLocatorId,
      );
      return best?.confidence ?? 0;
    })
    .filter((c) => c > 0);
  if (!confidences.length) return 0;
  return Number(
    (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4),
  );
}
