import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LocatorRecord, ScannedElement, UiScan } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { LocatorSource, LocatorStatus } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { toPagePattern } from './url-safety';
import { LocatorCandidate, LocatorData } from './ui-scanner.types';

export interface LocatorFilter {
  pageUrlPattern?: string;
  elementName?: string;
  approvedOnly?: boolean;
  activeOnly?: boolean;
}

/**
 * How long an active-locator snapshot is reused before it is read again
 * (FR-UIS-025 §17 "cached active-locator records").
 *
 * Short on purpose: the cache exists so that resolving twenty steps of a test
 * case costs one query rather than twenty, not so that an approval can go
 * unnoticed. Every write path through this service invalidates it anyway, so
 * the TTL only covers writes that happened on another instance.
 */
export const ACTIVE_LOCATOR_CACHE_TTL_MS = 15_000;

/** The frame chain of a locator, as the key stored on the record. */
export function frameKeyOf(locatorData: LocatorData | null | undefined): string {
  const path = locatorData?.frame?.path ?? [];
  return path.join(' >> ');
}

/** A locator offered to automation generation, with its provenance (§25). */
export interface ResolvedLocator {
  id: string;
  elementName: string;
  role: string;
  strategy: string;
  expression: string;
  pythonExpression: string;
  locatorData: LocatorData;
  confidenceScore: number;
  source: LocatorSource;
  pageUrlPattern: string;
  version: number;
}

/**
 * The project locator library (FR-UIS-021, FR-UIS-025).
 *
 * Approving a locator does not overwrite the previous one: the old row is
 * deactivated and the new one stored with an incremented version and a
 * `supersedesId` back-reference. That history is what makes a future
 * self-healing proposal reviewable — you can always see what the locator used
 * to be, who approved the change and when (FR-UIS-026).
 */
@Injectable()
export class LocatorStorageService {
  private readonly logger = new Logger(LocatorStorageService.name);

  /** Per-project snapshot of the active library (§17 caching). */
  private readonly activeCache = new Map<
    string,
    { at: number; rows: LocatorRecord[] }
  >();

  constructor(
    @InjectRepository(LocatorRecord)
    private readonly locators: Repository<LocatorRecord>,
    private readonly audit: AuditService,
  ) {}

  /** Drop the cached snapshot after any write to a project's library. */
  invalidate(projectId: string): void {
    this.activeCache.delete(projectId);
  }

  /**
   * Every active locator of a project, cached briefly (§17).
   *
   * Returns the entity rows rather than the trimmed `ResolvedLocator` view
   * because resolution needs the element snapshot, the frame key, the
   * validation timestamps and the approval flags to apply the source-priority
   * ladder (§2).
   */
  async activeForProject(projectId: string): Promise<LocatorRecord[]> {
    const cached = this.activeCache.get(projectId);
    if (cached && Date.now() - cached.at < ACTIVE_LOCATOR_CACHE_TTL_MS) {
      return cached.rows;
    }
    const rows = await this.locators.find({
      where: { projectId, active: true },
      order: { pageUrlPattern: 'ASC', elementName: 'ASC', version: 'DESC' },
      take: 5000,
    });
    this.activeCache.set(projectId, { at: Date.now(), rows });
    return rows;
  }

  /** One locator by id, scoped to its project (never by id alone). */
  async findById(
    projectId: string,
    locatorId: string,
  ): Promise<LocatorRecord | null> {
    const row = await this.locators.findOne({ where: { id: locatorId } });
    return row && row.projectId === projectId ? row : null;
  }

  async findManyByIds(
    projectId: string,
    locatorIds: string[],
  ): Promise<LocatorRecord[]> {
    if (!locatorIds.length) return [];
    const rows = await this.locators.find({ where: { id: In(locatorIds) } });
    return rows.filter((r) => r.projectId === projectId);
  }

  /**
   * Record the verdict of a live re-validation (§5 step 8).
   *
   * The verdict always comes from the browser; this only persists it, so a
   * later generation can trust `lastValidatedAt` instead of paying for another
   * browser launch.
   */
  async recordValidation(
    locator: LocatorRecord,
    verdict: {
      matchCount: number;
      unique: boolean;
      valid: boolean;
      error?: string;
    },
  ): Promise<LocatorRecord> {
    locator.matchCount = verdict.matchCount;
    locator.validationStatus = verdict.unique
      ? 'unique'
      : verdict.matchCount > 1
        ? 'multiple_matches'
        : 'invalid';
    // Only a passing verdict refreshes the freshness clock: a failed probe
    // must not make a broken locator look recently validated.
    if (verdict.unique) locator.lastValidatedAt = new Date();
    const saved = await this.locators.save(locator);
    this.invalidate(locator.projectId);
    return saved;
  }

  /** Human-facing element name used to match a test step's intent. */
  static elementNameOf(element: ScannedElement): string {
    const attributes = (element.attributes ?? {}) as Record<string, unknown>;
    const context = (element.context ?? {}) as Record<string, unknown>;
    return (
      element.accessibleName ||
      String(context.associatedLabel || '') ||
      String(attributes.placeholder || '') ||
      element.visibleText.slice(0, 60) ||
      String(attributes.name || '') ||
      element.elementKey
    );
  }

  /**
   * Persist the approved locators of a scan into the project library.
   *
   * Idempotent per element: re-saving the same locator for the same element
   * updates the existing active row instead of piling up versions.
   */
  async saveApproved(
    scan: UiScan,
    elements: ScannedElement[],
    user: AuthUser,
    pageName: string,
    correlationId?: string,
  ): Promise<{ saved: number; superseded: number; records: LocatorRecord[] }> {
    const records: LocatorRecord[] = [];
    const patterns = new Set<string>();
    let superseded = 0;

    for (const element of elements) {
      const candidate = this.recommendedCandidate(element);
      if (!candidate) continue;

      // A crawl spans several pages, so the page pattern comes from the
      // element's own page — filing a Reports button under the Dashboard URL
      // would hand automation generation the wrong locator for the step.
      const pattern = toPagePattern(element.pageUrl || scan.finalUrl || scan.url);
      patterns.add(pattern);
      const elementName = LocatorStorageService.elementNameOf(element);
      const existing = await this.locators.findOne({
        where: {
          projectId: scan.projectId,
          pageUrlPattern: pattern,
          elementKey: element.elementKey,
          active: true,
        },
      });

      if (existing && existing.expression === candidate.expression) {
        // Same locator re-approved: refresh the verdict, keep the version.
        existing.confidenceScore = candidate.confidence;
        existing.matchCount = candidate.matchCount;
        existing.validationStatus = element.status;
        existing.approved = true;
        existing.approvedBy = user.id;
        existing.lastValidatedAt = new Date();
        existing.scanId = scan.id;
        existing.scannedElementId = element.id;
        existing.frameKey = frameKeyOf(candidate.locatorData);
        existing.pageState = pageStateOf(element);
        records.push(await this.locators.save(existing));
        continue;
      }

      if (existing) {
        existing.active = false;
        await this.locators.save(existing);
        superseded += 1;
      }

      const record = this.locators.create({
        projectId: scan.projectId,
        scanId: scan.id,
        scannedElementId: element.id,
        elementKey: element.elementKey,
        pageName: pageName || scan.pageTitle || '',
        pageUrlPattern: pattern,
        elementName,
        role: element.role,
        frameKey: frameKeyOf(candidate.locatorData),
        pageState: pageStateOf(element),
        strategy: candidate.strategy,
        locatorData: candidate.locatorData as unknown as Record<string, unknown>,
        expression: candidate.expression,
        pythonExpression: candidate.pythonExpression,
        confidenceScore: candidate.confidence,
        matchCount: candidate.matchCount,
        validationStatus: element.status,
        approved: true,
        active: true,
        version: existing ? existing.version + 1 : 1,
        supersedesId: existing?.id ?? null,
        source: candidate.source,
        rationale: {
          reasons: candidate.reasons,
          warnings: candidate.warnings,
          finalScore: candidate.finalScore,
        },
        // Kept for self-healing: a future scan compares against this snapshot
        // to decide whether a changed element is still the same control.
        elementSnapshot: {
          tagName: element.tagName,
          role: element.role,
          accessibleName: element.accessibleName,
          visibleText: element.visibleText,
          attributes: element.attributes,
          context: element.context,
          position: element.position,
          frame: element.frame,
        },
        createdBy: user.id,
        approvedBy: user.id,
        lastValidatedAt: new Date(),
      });
      records.push(await this.locators.save(record));
    }

    this.invalidate(scan.projectId);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ui_scan.locators.save',
      resourceType: 'ui_scan',
      resourceId: scan.id,
      projectId: scan.projectId,
      correlationId,
      metadata: {
        saved: records.length,
        superseded,
        pageUrlPatterns: [...patterns],
      },
    });

    return { saved: records.length, superseded, records };
  }

  private recommendedCandidate(element: ScannedElement): LocatorCandidate | null {
    const candidates = (element.candidates ?? []) as unknown as LocatorCandidate[];
    if (!candidates.length) return null;
    return (
      candidates.find((c) => c.id === element.recommendedLocatorId) ?? candidates[0] ?? null
    );
  }

  async listByProject(
    projectId: string,
    filter: LocatorFilter = {},
  ): Promise<LocatorRecord[]> {
    const where: Record<string, unknown> = { projectId };
    if (filter.pageUrlPattern) where.pageUrlPattern = filter.pageUrlPattern;
    if (filter.elementName) where.elementName = filter.elementName;
    if (filter.approvedOnly) where.approved = true;
    if (filter.activeOnly !== false) where.active = true;
    return this.locators.find({
      where,
      order: { pageUrlPattern: 'ASC', elementName: 'ASC', version: 'DESC' },
      take: 1000,
    });
  }

  /** Every approved, active locator of a project, for automation generation. */
  async approvedForProject(projectId: string): Promise<ResolvedLocator[]> {
    const rows = await this.locators.find({
      where: { projectId, approved: true, active: true },
      order: { pageUrlPattern: 'ASC', elementName: 'ASC' },
      take: 1000,
    });
    return rows.map((r) => ({
      id: r.id,
      elementName: r.elementName,
      role: r.role,
      strategy: r.strategy,
      expression: r.expression,
      pythonExpression: r.pythonExpression,
      locatorData: r.locatorData as unknown as LocatorData,
      confidenceScore: r.confidenceScore,
      source: r.source,
      pageUrlPattern: r.pageUrlPattern,
      version: r.version,
    }));
  }

  /**
   * Best approved locator for a test-step intent (FR-UIS-025).
   *
   * Deliberately conservative: matching is by element name and role token
   * overlap, and a weak match returns nothing so the generator falls back
   * rather than wiring a test to the wrong control.
   */
  async matchIntent(
    projectId: string,
    intent: string,
    pageUrlPattern?: string,
  ): Promise<ResolvedLocator | null> {
    const candidates = await this.approvedForProject(projectId);
    const scoped = pageUrlPattern
      ? candidates.filter((c) => c.pageUrlPattern === pageUrlPattern)
      : candidates;
    const pool = scoped.length ? scoped : candidates;
    const wanted = tokenise(intent);
    if (!wanted.size) return null;

    let best: ResolvedLocator | null = null;
    let bestScore = 0;
    for (const candidate of pool) {
      const have = tokenise(`${candidate.elementName} ${candidate.role}`);
      const overlap = [...have].filter((t) => wanted.has(t)).length;
      if (!overlap) continue;
      const score = overlap / have.size + candidate.confidenceScore / 10;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    // Require a real overlap, not a single incidental stop-word.
    return bestScore >= 0.5 ? best : null;
  }

  /**
   * Record a proposed replacement for a locator that no longer resolves
   * (FR-UIS-026 self-healing preparation).
   *
   * The proposal is stored inactive and unapproved with `needs_review`, and
   * the current locator keeps working until a human accepts the change. This
   * system never silently swaps a locator underneath a test suite.
   */
  async proposeReplacement(
    current: LocatorRecord,
    candidate: LocatorCandidate,
    reason: string,
    user: AuthUser | null,
    correlationId?: string,
  ): Promise<LocatorRecord> {
    const proposal = this.locators.create({
      projectId: current.projectId,
      scanId: current.scanId,
      scannedElementId: current.scannedElementId,
      elementKey: current.elementKey,
      pageName: current.pageName,
      pageUrlPattern: current.pageUrlPattern,
      elementName: current.elementName,
      role: current.role,
      frameKey: frameKeyOf(candidate.locatorData),
      pageState: current.pageState,
      strategy: candidate.strategy,
      locatorData: candidate.locatorData as unknown as Record<string, unknown>,
      expression: candidate.expression,
      pythonExpression: candidate.pythonExpression,
      confidenceScore: candidate.confidence,
      matchCount: candidate.matchCount,
      validationStatus: 'needs_review' as LocatorStatus,
      approved: false,
      active: false,
      version: current.version + 1,
      supersedesId: current.id,
      source: candidate.source,
      rationale: {
        healing: true,
        reason,
        previousExpression: current.expression,
        reasons: candidate.reasons,
        warnings: candidate.warnings,
      },
      elementSnapshot: current.elementSnapshot,
      createdBy: user?.id ?? null,
    });
    const saved = await this.locators.save(proposal);
    this.invalidate(current.projectId);
    this.logger.log(
      `locator ${current.id} has a replacement proposal ${saved.id} awaiting review`,
    );
    if (user) {
      await this.audit.record({
        actor: user.email,
        actorId: user.id,
        action: 'ui_scan.locator.heal_proposed',
        resourceType: 'locator',
        resourceId: saved.id,
        projectId: current.projectId,
        correlationId,
        metadata: { supersedesId: current.id, reason },
      });
    }
    return saved;
  }

  /** History of one element's locators, newest first (§26 review UI). */
  async history(projectId: string, elementKey: string): Promise<LocatorRecord[]> {
    return this.locators.find({
      where: { projectId, elementKey },
      order: { version: 'DESC' },
      take: 50,
    });
  }

  async countApproved(projectId: string): Promise<number> {
    return this.locators.count({ where: { projectId, approved: true, active: true } });
  }
}

/**
 * Named page state an element was captured in (§4 "correct page state").
 *
 * The scanner records the containers an element sits in; a control inside an
 * open dialog belongs to a different page state than the same control on the
 * page behind it, and resolving a step must not cross that boundary.
 */
export function pageStateOf(element: ScannedElement): string {
  const context = (element.context ?? {}) as Record<string, unknown>;
  const scopes = (context.scopes as { role?: string; name?: string }[]) ?? [];
  const dialog = scopes.find((s) => s.role === 'dialog');
  return dialog ? `dialog:${String(dialog.name ?? '').trim()}` : '';
}

/** Lowercase content words, with the noise a test step is full of removed. */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'in',
  'on',
  'at',
  'of',
  'for',
  'with',
  'click',
  'enter',
  'type',
  'fill',
  'select',
  'verify',
  'check',
  'user',
  'page',
  'field',
  'button',
  'link',
  'then',
  'when',
  'should',
  'is',
  'be',
  'into',
]);

function tokenise(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}
