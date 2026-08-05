import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LocatorRecord, Project, TestCase } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  LocatorResolutionSource,
  LocatorResolutionStatus,
  LocatorStatus,
  LocatorStrategy,
} from '../../common/enums';
import { NotFoundAppException } from '../../common/errors';
import { EngineClient } from '../../engine/engine.client';
import { LocatorStorageService } from '../ui-scanner/locator-storage.service';
import { UiScanArtifactsService } from '../ui-scanner/ui-scan-artifacts.service';
import { UiScannerService } from '../ui-scanner/ui-scanner.service';
import {
  ALLOW_PRIVATE_NETWORK,
  DEFAULT_TIMEOUT_MS,
} from '../ui-scanner/ui-scanner.limits';
import { parseAllowedHosts } from '../ui-scanner/url-safety';
import { LocatorData } from '../ui-scanner/ui-scanner.types';
import {
  ElementMatch,
  ElementMatcherService,
  MatchableElement,
} from './element-matcher.service';
import {
  MAX_LLM_MATCH_ELEMENTS,
  MAX_PARALLEL_REVALIDATION_PAGES,
  MAX_REVALIDATIONS_PER_REQUEST,
  MIN_ELEMENT_MATCH_CONFIDENCE,
  MIN_LOCATOR_CONFIDENCE,
  MIN_UNAPPROVED_LOCATOR_CONFIDENCE,
  LOCATOR_FRESHNESS_MS,
  REVALIDATION_BATCH_SIZE,
  TARGETED_RESCAN_POLL_MS,
  TARGETED_RESCAN_TIMEOUT_MS,
} from './locator-resolution.limits';
import {
  AutomationTestStep,
  LocatorResolutionOptions,
  LocatorResolutionResult,
  LocatorResolutionTimings,
  ResolvedAutomationLocator,
  UnresolvedAutomationStep,
} from './locator-resolution.types';
import { PlannableTestCase, planTestSteps } from './test-step-planner';

/** Validation verdicts a locator may be generated from without re-probing. */
const TRUSTED_VALIDATION: readonly LocatorStatus[] = ['unique', 'valid', 'approved'];

/** Verdicts that permanently disqualify a locator (§18). */
const DISQUALIFYING_VALIDATION: readonly LocatorStatus[] = [
  'invalid',
  'rejected',
  'multiple_matches',
];

/** Why a locator was sent back to the browser (§5), for the log and the UI. */
type RevalidationReason =
  | 'never-executed'
  | 'stale'
  | 'previous-failure'
  | 'low-confidence'
  | 'manually-edited'
  | 'needs-review';

interface CandidateBinding {
  step: AutomationTestStep;
  match: ElementMatch;
  record: LocatorRecord;
}

/**
 * Binding automation test steps to locators the UI Scanner already validated
 * (FR-UIS-025).
 *
 * The generator does not get to invent selectors, so this service is what
 * stands between a test step and a Playwright line. It applies one fixed
 * priority order (§2):
 *
 *   1. approved, active and recently validated
 *   2. approved, but re-validated against the live page first
 *   3. valid, unique, high-confidence — still awaiting approval
 *   4. a targeted rescan of the page the step needs
 *   5. the model, used *only* to match a step to an already-scanned element
 *   6. unresolved — the step is marked for review
 *
 * A model-proposed selector never enters that ladder at all. The model's
 * largest possible contribution is choosing between elements the scanner
 * already found and validated, and even then the locator it ends up bound to
 * is the scanner's, not its own.
 */
@Injectable()
export class LocatorResolutionService {
  private readonly logger = new Logger(LocatorResolutionService.name);

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(TestCase) private readonly cases: Repository<TestCase>,
    private readonly locators: LocatorStorageService,
    private readonly matcher: ElementMatcherService,
    private readonly engine: EngineClient,
    private readonly scanner: UiScannerService,
    private readonly artifacts: UiScanArtifactsService,
  ) {}

  /**
   * Resolve every locator-bearing step of one test case.
   *
   * Everything is batched: one library read, one matching pass, at most one
   * browser session per page, and one grouped model request for whatever is
   * left. A test case with twenty steps must not cost twenty browser launches
   * (§17).
   */
  async resolveTestCase(
    projectId: string,
    testCase: PlannableTestCase & { caseKey?: string },
    user: AuthUser,
    options: LocatorResolutionOptions = {},
  ): Promise<LocatorResolutionResult> {
    const [result] = await this.resolveBatch(projectId, [testCase], user, options);
    return result!;
  }

  /**
   * Resolve several test cases in one pass (§16 "prefer batch resolution").
   *
   * The library is read once, revalidation is grouped by page across *all*
   * cases, and the model — if it is needed at all — sees every leftover step
   * in a single request.
   */
  async resolveBatch(
    projectId: string,
    testCases: (PlannableTestCase & { caseKey?: string })[],
    user: AuthUser,
    options: LocatorResolutionOptions = {},
  ): Promise<LocatorResolutionResult[]> {
    const started = Date.now();
    const timings: LocatorResolutionTimings = {
      lookupMs: 0,
      matchingMs: 0,
      revalidationMs: 0,
      llmFallbackMs: 0,
      rescanMs: 0,
      totalMs: 0,
    };
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundAppException(`Project ${projectId} not found`);
    }

    // --- 1. library lookup (cached, indexed) ------------------------------
    const lookupStart = Date.now();
    const library = await this.locators.activeForProject(projectId);
    timings.lookupMs = Date.now() - lookupStart;

    const warnings: string[] = [];
    if (!library.length) {
      warnings.push(
        'This project has no scanned locators. Run a UI scan and approve its ' +
          'locators — every UI step will otherwise be marked for review.',
      );
    }

    const byId = new Map(library.map((r) => [r.id, r]));
    const matchable = library.map((record) => this.matcher.toMatchable(record));
    const matchableById = new Map(matchable.map((m) => [m.locatorId, m]));

    // --- 2. deterministic matching ----------------------------------------
    const matchStart = Date.now();
    const plans = testCases.map((testCase) => ({
      testCase,
      steps: planTestSteps(testCase),
    }));
    const minMatch = options.minMatchConfidence ?? MIN_ELEMENT_MATCH_CONFIDENCE;
    const minLocator = options.minLocatorConfidence ?? MIN_LOCATOR_CONFIDENCE;

    const bindings: CandidateBinding[] = [];
    const unresolved = new Map<string, UnresolvedAutomationStep>();
    const stepsById = new Map<string, AutomationTestStep>();

    for (const plan of plans) {
      for (const step of plan.steps) {
        stepsById.set(step.testStepId, step);
        if (!step.requiresLocator) continue;
        const outcome = this.matcher.match(step, matchable);
        const best = outcome.best;

        if (!best || best.confidence < minMatch) {
          unresolved.set(
            step.testStepId,
            this.unresolvedStep(
              step,
              library.length
                ? 'No approved locator matched this test step.'
                : 'No UI scan has been saved for this project.',
              library.length
                ? `Run a targeted UI scan for the ${step.pageName || 'target'} page, or rename the element so the step and the scan agree.`
                : 'Run a UI scan of the application and approve the discovered locators.',
              outcome.ranked.map((r) => r.element.elementName),
            ),
          );
          continue;
        }
        if (outcome.ambiguous) {
          unresolved.set(
            step.testStepId,
            this.unresolvedStep(
              step,
              'Two scanned elements match this test step equally well; the step ' +
                'does not say which one it means.',
              'Name the containing section, dialog or form in the test step, or ' +
                'give the elements distinct names in the UI Scanner.',
              outcome.ranked.map((r) => r.element.elementName),
            ),
          );
          continue;
        }

        // An approved locator must never be beaten by an unapproved one for
        // the same control (§2): when both are in play and the scores are
        // close, the approved row wins regardless of ranking order.
        const chosen = preferApproved(outcome.ranked, best);
        const record = byId.get(chosen.element.locatorId);
        if (!record) continue;
        bindings.push({ step, match: chosen, record });
      }
    }
    timings.matchingMs = Date.now() - matchStart;
    await this.assertNotCancelled(options);

    // --- 3. priority ladder + revalidation ---------------------------------
    const resolved = new Map<string, ResolvedAutomationLocator>();
    const needsRevalidation: { binding: CandidateBinding; reason: RevalidationReason }[] = [];

    for (const binding of bindings) {
      const { record } = binding;
      const disqualified = this.disqualify(record, minLocator);
      if (disqualified) {
        unresolved.set(
          binding.step.testStepId,
          this.unresolvedStep(
            binding.step,
            disqualified,
            'Re-approve the locator in the UI Scanner, or rescan the page.',
            [record.elementName],
          ),
        );
        continue;
      }

      const reason = this.revalidationReason(record, minLocator);
      if (!reason) {
        // Priority 1: approved, active, validated recently enough to trust.
        resolved.set(
          binding.step.testStepId,
          this.toResolved(binding, project, {
            source: this.sourceOf(record),
            revalidated: false,
          }),
        );
        continue;
      }
      needsRevalidation.push({ binding, reason });
    }

    // Priority 2: everything uncertain goes back to the browser — grouped by
    // page so one authenticated context serves every step on that page.
    if (needsRevalidation.length && options.revalidate !== false) {
      const revalidationStart = Date.now();
      const verdicts = await this.revalidateGrouped(
        project,
        needsRevalidation.map((n) => n.binding.record),
        options,
      );
      timings.revalidationMs = Date.now() - revalidationStart;

      for (const { binding, reason } of needsRevalidation) {
        const verdict = verdicts.get(binding.record.id);
        if (verdict?.unique) {
          resolved.set(
            binding.step.testStepId,
            this.toResolved(binding, project, {
              source: this.sourceOf(binding.record),
              revalidated: true,
            }),
          );
          continue;
        }
        unresolved.set(
          binding.step.testStepId,
          this.unresolvedStep(
            binding.step,
            verdict
              ? `The stored locator no longer resolves this element (${verdict.error || `${verdict.matchCount} match(es)`}).`
              : `The locator could not be re-validated (${reason}).`,
            `Rescan the ${binding.record.pageName || 'target'} page and approve the refreshed locator.`,
            [binding.record.elementName],
          ),
        );
      }
    } else if (needsRevalidation.length) {
      // Revalidation was switched off: use what is trustworthy on its face and
      // mark the rest, never silently.
      for (const { binding, reason } of needsRevalidation) {
        unresolved.set(
          binding.step.testStepId,
          this.unresolvedStep(
            binding.step,
            `The locator needs re-validation (${reason}) and revalidation is disabled for this request.`,
            'Re-run resolution with revalidation enabled.',
            [binding.record.elementName],
          ),
        );
      }
    }
    await this.assertNotCancelled(options);

    // --- 4. targeted rescan (opt-in) --------------------------------------
    if (options.allowTargetedRescan && unresolved.size) {
      const rescanStart = Date.now();
      const rescanned = await this.targetedRescan(
        project,
        [...unresolved.values()],
        stepsById,
        user,
        options,
      );
      timings.rescanMs = Date.now() - rescanStart;
      if (rescanned) {
        // The library changed underneath us; re-read and re-match only the
        // steps that are still unresolved.
        this.locators.invalidate(projectId);
        const refreshed = await this.locators.activeForProject(projectId);
        const refreshedMatchable = refreshed.map((r) => this.matcher.toMatchable(r));
        const refreshedById = new Map(refreshed.map((r) => [r.id, r]));
        for (const pending of [...unresolved.values()]) {
          const step = stepsById.get(pending.testStepId);
          if (!step) continue;
          const outcome = this.matcher.match(step, refreshedMatchable);
          const best = outcome.best;
          if (!best || best.confidence < minMatch || outcome.ambiguous) continue;
          const record = refreshedById.get(best.element.locatorId);
          if (!record || this.disqualify(record, minLocator)) continue;
          resolved.set(
            step.testStepId,
            this.toResolved({ step, match: best, record }, project, {
              source: this.sourceOf(record),
              revalidated: true,
            }),
          );
          unresolved.delete(step.testStepId);
        }
      }
    }
    await this.assertNotCancelled(options);

    // --- 5. model-assisted matching against SCANNED elements only ----------
    if (options.allowLlmMatching !== false && unresolved.size && matchable.length) {
      const llmStart = Date.now();
      try {
        const proposals = await this.llmMatch(
          project,
          [...unresolved.values()],
          stepsById,
          matchable,
          options,
        );
        for (const [testStepId, locatorId] of proposals) {
          const step = stepsById.get(testStepId);
          const record = byId.get(locatorId);
          const element = matchableById.get(locatorId);
          if (!step || !record || !element) continue;
          if (this.disqualify(record, minLocator)) continue;
          if (this.revalidationReason(record, minLocator)) continue;
          resolved.set(
            testStepId,
            this.toResolved(
              {
                step,
                match: {
                  element,
                  // The model chose the element; the confidence stays modest
                  // and the source records that a model was involved, so a
                  // reviewer can see exactly which steps it touched.
                  confidence: 0.6,
                  rationale: { matchedBy: 'model', model: project.llmModel || 'default' },
                },
                record,
              },
              project,
              { source: 'LLM_FALLBACK', revalidated: false },
            ),
          );
          unresolved.delete(testStepId);
        }
      } catch (err) {
        // A model failure must not fail generation: the affected steps simply
        // stay unmatched and are reported as a diagnostic (§18).
        warnings.push(
          `Model-assisted step matching was unavailable: ${(err as Error).message}`,
        );
        this.logger.warn(`LLM step matching failed: ${(err as Error).message}`);
      }
      timings.llmFallbackMs = Date.now() - llmStart;
    }

    timings.totalMs = Date.now() - started;

    // --- 6. assemble per-test-case results --------------------------------
    return plans.map(({ testCase, steps }) => {
      const caseResolved = steps
        .map((s) => resolved.get(s.testStepId))
        .filter((r): r is ResolvedAutomationLocator => !!r);
      const caseUnresolved = steps
        .map((s) => unresolved.get(s.testStepId))
        .filter((u): u is UnresolvedAutomationStep => !!u);
      const status: LocatorResolutionStatus = caseUnresolved.length
        ? caseResolved.length
          ? 'PARTIALLY_RESOLVED'
          : 'NO_APPROVED_MATCH'
        : 'RESOLVED';
      return {
        testCaseId: testCase.id,
        caseKey: testCase.caseKey ?? '',
        status,
        resolvedSteps: caseResolved,
        unresolvedSteps: caseUnresolved,
        timings,
        revalidatedLocatorIds: caseResolved
          .filter((r) => r.revalidated)
          .map((r) => r.locatorId),
        warnings,
      };
    });
  }

  // --- API-facing entry points (§16) --------------------------------------

  /**
   * Resolve one test case, or an ad-hoc list of steps, for the resolve API.
   *
   * The ad-hoc form exists so a caller can check how a step *would* resolve
   * before committing to generation — same matcher, same ladder, same result
   * shape.
   */
  async resolveRequest(
    projectId: string,
    input: {
      testCaseId?: string;
      pageName?: string;
      steps?: { testStepId: string; description: string; action?: string; sequence?: number }[];
    },
    user: AuthUser,
    options: LocatorResolutionOptions = {},
  ): Promise<LocatorResolutionResult> {
    if (input.testCaseId) {
      const testCase = await this.cases.findOne({
        where: { id: input.testCaseId, projectId },
      });
      if (!testCase) {
        throw new NotFoundAppException(
          `Test case ${input.testCaseId} not found in this project`,
        );
      }
      return this.resolveTestCase(projectId, testCase, user, options);
    }

    if (!input.steps?.length) {
      throw new NotFoundAppException(
        'Provide either a testCaseId or a non-empty list of steps to resolve.',
      );
    }
    // An ad-hoc request supplies its own step ids, so the synthetic case
    // preserves them rather than re-deriving `<caseId>:step-n`.
    const synthetic: PlannableTestCase & { caseKey?: string } = {
      id: 'adhoc',
      caseKey: 'AD-HOC',
      steps: input.steps.map((s) => s.description),
      preconditions: input.pageName ? [`On the ${input.pageName} page`] : [],
    };
    const [result] = await this.resolveBatch(projectId, [synthetic], user, options);
    const byIndex = input.steps;
    const rename = <T extends { sequence: number; testStepId: string }>(item: T): T => {
      const supplied = byIndex[item.sequence - 1];
      return supplied ? { ...item, testStepId: supplied.testStepId } : item;
    };
    return {
      ...result!,
      testCaseId: input.testCaseId ?? 'adhoc',
      resolvedSteps: result!.resolvedSteps.map(rename),
      unresolvedSteps: result!.unresolvedSteps.map(rename),
    };
  }

  /** Resolve several approved test cases in one request (§16). */
  async resolveTestCases(
    projectId: string,
    testCaseIds: string[],
    user: AuthUser,
    options: LocatorResolutionOptions = {},
  ): Promise<LocatorResolutionResult[]> {
    const cases = await this.cases.find({
      where: { projectId, id: In(testCaseIds) },
    });
    if (!cases.length) {
      throw new NotFoundAppException('No matching test cases found in this project');
    }
    return this.resolveBatch(projectId, cases, user, options);
  }

  /**
   * Re-validate specific stored locators on demand (§16 `/revalidate`).
   *
   * The verdict comes from the live application and is persisted, so the next
   * generation can trust it without opening a browser again.
   */
  async revalidateLocators(
    projectId: string,
    locatorIds: string[],
    options: LocatorResolutionOptions = {},
  ): Promise<{
    locatorId: string;
    matchCount: number;
    unique: boolean;
    validationStatus: LocatorStatus;
    error?: string;
  }[]> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);
    const records = await this.locators.findManyByIds(projectId, locatorIds);
    if (!records.length) {
      throw new NotFoundAppException('None of those locators belong to this project');
    }
    const verdicts = await this.revalidateGrouped(project, records, options);
    return records.map((record) => {
      const verdict = verdicts.get(record.id);
      return {
        locatorId: record.id,
        matchCount: verdict?.matchCount ?? 0,
        unique: verdict?.unique ?? false,
        validationStatus: verdict
          ? verdict.unique
            ? 'unique'
            : verdict.matchCount > 1
              ? 'multiple_matches'
              : 'invalid'
          : record.validationStatus,
        error: verdict?.error || undefined,
      };
    });
  }

  // --- priority ladder helpers -------------------------------------------

  /**
   * Reasons a locator can never be generated from as it stands (§4, §18).
   *
   * An unapproved locator is held to a higher bar than an approved one: nobody
   * has reviewed it, so it has to be unique and confident on its own merits
   * before it may reach priority 3 of the ladder.
   */
  private disqualify(record: LocatorRecord, minConfidence: number): string | null {
    if (!record.active) return 'The locator has been superseded and is no longer active.';
    if (record.validationStatus === 'rejected') return 'The locator was rejected during review.';
    if (!record.locatorData || !Object.keys(record.locatorData).length) {
      return 'The locator has no machine-readable definition and cannot be rebuilt.';
    }
    if (!record.expression && !record.pythonExpression) {
      return 'The locator has no generated Playwright expression.';
    }
    if (record.approved) {
      if (record.confidenceScore < minConfidence) {
        return `The locator's confidence (${record.confidenceScore.toFixed(2)}) is below the generation threshold of ${minConfidence}.`;
      }
      return null;
    }
    if (record.validationStatus !== 'unique') {
      return 'The locator has not been approved and did not validate as unique.';
    }
    if (record.confidenceScore < MIN_UNAPPROVED_LOCATOR_CONFIDENCE) {
      return `The locator has not been approved and its confidence (${record.confidenceScore.toFixed(2)}) is below the ${MIN_UNAPPROVED_LOCATOR_CONFIDENCE} bar required without review.`;
    }
    return null;
  }

  /**
   * Whether a locator must be re-probed before it is used (§5).
   *
   * Deliberately *not* "always": re-validating every locator on every
   * generation would open a browser for work that has not changed. What
   * triggers a probe is uncertainty — never validated, gone stale, failed last
   * time, hand-edited, or below the confidence bar.
   */
  private revalidationReason(
    record: LocatorRecord,
    minConfidence: number,
  ): RevalidationReason | null {
    if (record.validationStatus === 'manually_edited' || record.source === 'manual') {
      return 'manually-edited';
    }
    if (DISQUALIFYING_VALIDATION.includes(record.validationStatus)) return 'needs-review';
    if (!TRUSTED_VALIDATION.includes(record.validationStatus)) return 'needs-review';
    if (!record.lastValidatedAt) return 'never-executed';
    if (Date.now() - new Date(record.lastValidatedAt).getTime() > LOCATOR_FRESHNESS_MS) {
      return 'stale';
    }
    if (record.locatorFailure) return 'previous-failure';
    if (record.confidenceScore < minConfidence) return 'low-confidence';
    return null;
  }

  private sourceOf(record: LocatorRecord): LocatorResolutionSource {
    return record.source === 'manual' ? 'MANUAL_EDIT' : 'DETERMINISTIC_SCANNER';
  }

  // --- revalidation -------------------------------------------------------

  /**
   * Re-validate locators against the live application, grouped by page (§17).
   *
   * One engine call per page (in batches the engine accepts) rather than one
   * per step: the engine opens a single browser context, signs in once if the
   * caller supplied credentials, and probes every locator on that page.
   */
  async revalidateGrouped(
    project: Project,
    records: LocatorRecord[],
    options: LocatorResolutionOptions = {},
  ): Promise<Map<string, { matchCount: number; unique: boolean; error?: string }>> {
    const verdicts = new Map<string, { matchCount: number; unique: boolean; error?: string }>();
    if (!records.length) return verdicts;

    const byPage = new Map<string, LocatorRecord[]>();
    for (const record of records.slice(0, MAX_REVALIDATIONS_PER_REQUEST)) {
      const page = record.pageUrlPattern || project.baseUrl;
      if (!page) continue;
      const bucket = byPage.get(page) ?? [];
      bucket.push(record);
      byPage.set(page, bucket);
    }

    const allowedHosts = parseAllowedHosts(project.allowedDomains);
    const storageState = options.auth?.storageStateId
      ? await this.readStorageState(project.id, options.auth.storageStateId)
      : undefined;

    const pages = [...byPage.entries()];
    // Bounded parallelism: each page owns a browser context on the engine
    // host, so this is a real resource, not a loop counter (§17).
    for (let i = 0; i < pages.length; i += MAX_PARALLEL_REVALIDATION_PAGES) {
      if (await this.isCancelled(options)) break;
      const slice = pages.slice(i, i + MAX_PARALLEL_REVALIDATION_PAGES);
      await Promise.all(
        slice.map(async ([url, group]) => {
          for (let b = 0; b < group.length; b += REVALIDATION_BATCH_SIZE) {
            const batch = group.slice(b, b + REVALIDATION_BATCH_SIZE);
            try {
              const outcome = await this.engine.validateUiLocators(
                {
                  url,
                  browser: 'chromium',
                  headless: true,
                  timeoutMs: DEFAULT_TIMEOUT_MS,
                  allowedHosts,
                  allowPrivateNetwork: ALLOW_PRIVATE_NETWORK,
                  loginUrl: options.auth?.loginUrl,
                  username: options.auth?.username,
                  password: options.auth?.password,
                  storageState,
                  locators: batch.map((r) => ({
                    id: r.id,
                    locatorData: r.locatorData,
                  })),
                },
                options.correlationId,
              );
              for (const verdict of outcome.results ?? []) {
                verdicts.set(verdict.id, {
                  matchCount: verdict.matchCount,
                  unique: verdict.unique,
                  error: verdict.error,
                });
                const record = batch.find((r) => r.id === verdict.id);
                if (record) await this.locators.recordValidation(record, verdict);
              }
            } catch (err) {
              // The page could not be opened at all (§18): every locator in
              // this batch stays unverified, with the reason attached.
              const message = (err as Error).message;
              this.logger.warn(`revalidation failed for ${url}: ${message}`);
              for (const record of batch) {
                verdicts.set(record.id, {
                  matchCount: 0,
                  unique: false,
                  error: `the page could not be opened: ${message}`,
                });
              }
            }
          }
        }),
      );
    }
    return verdicts;
  }

  private async readStorageState(
    projectId: string,
    storageStateId: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      // Resolved by id inside the project's own directory; a filesystem path
      // is never accepted here either (§16).
      return await this.artifacts.readStorageState(projectId, storageStateId);
    } catch (err) {
      this.logger.warn(
        `storage state ${storageStateId} unavailable: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  // --- targeted rescan ----------------------------------------------------

  /**
   * Rescan the single page the unresolved steps point at (§2.4).
   *
   * Bounded on every axis: one page, one scan, a hard deadline, and it only
   * runs when the caller opted in. Returns whether a scan actually completed.
   */
  private async targetedRescan(
    project: Project,
    pending: UnresolvedAutomationStep[],
    stepsById: Map<string, AutomationTestStep>,
    user: AuthUser,
    options: LocatorResolutionOptions,
  ): Promise<boolean> {
    const target = this.rescanTarget(project, pending, stepsById);
    if (!target) return false;

    let scanId: string;
    try {
      const started = await this.scanner.start(
        project.id,
        {
          url: target,
          maxPages: 1,
          loginUrl: options.auth?.loginUrl,
          username: options.auth?.username,
          password: options.auth?.password,
          storageStateId: options.auth?.storageStateId,
        },
        user,
        options.correlationId,
      );
      scanId = started.id;
    } catch (err) {
      this.logger.warn(`targeted rescan refused: ${(err as Error).message}`);
      return false;
    }

    const deadline = Date.now() + TARGETED_RESCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isCancelled(options)) {
        await this.scanner
          .cancel(project.id, scanId, user, options.correlationId)
          .catch(() => undefined);
        return false;
      }
      await sleep(TARGETED_RESCAN_POLL_MS);
      const scan = await this.scanner.getOne(project.id, scanId, user);
      if (scan.status === 'COMPLETED') return true;
      if (scan.status === 'FAILED' || scan.status === 'CANCELLED') return false;
    }
    await this.scanner
      .cancel(project.id, scanId, user, options.correlationId)
      .catch(() => undefined);
    return false;
  }

  /** The page a targeted rescan should open, from the unresolved steps. */
  private rescanTarget(
    project: Project,
    pending: UnresolvedAutomationStep[],
    stepsById: Map<string, AutomationTestStep>,
  ): string {
    for (const item of pending) {
      const step = stepsById.get(item.testStepId);
      if (step?.pageUrlPattern) return step.pageUrlPattern;
    }
    return project.baseUrl || '';
  }

  // --- model-assisted matching -------------------------------------------

  /**
   * Ask the model to match leftover steps to elements the scanner already
   * found (§2.5, §11.4).
   *
   * What it receives is compact element *metadata* — never page HTML, never a
   * request for a selector. What it may return is a locator id from the list it
   * was given; anything else is discarded by the caller. The model therefore
   * cannot introduce a selector into the generated suite even if it tries.
   */
  private async llmMatch(
    project: Project,
    pending: UnresolvedAutomationStep[],
    stepsById: Map<string, AutomationTestStep>,
    elements: MatchableElement[],
    options: LocatorResolutionOptions,
  ): Promise<Map<string, string>> {
    const offered = elements.slice(0, MAX_LLM_MATCH_ELEMENTS);
    const response = await this.engine.matchLocators(
      {
        steps: pending.map((item) => {
          const step = stepsById.get(item.testStepId);
          return {
            testStepId: item.testStepId,
            description: item.testStep,
            action: item.action,
            pageName: step?.pageName ?? '',
            parentContext: step?.parentContext ?? '',
          };
        }),
        elements: offered.map((element) => ({
          locatorId: element.locatorId,
          elementName: element.elementName,
          role: element.role,
          inputType: element.inputType,
          pageName: element.pageName,
          pageUrlPattern: element.pageUrlPattern,
          accessibleName: element.accessibleName,
          label: element.associatedLabel,
          placeholder: element.placeholder,
          visibleText: element.visibleText.slice(0, 80),
          container: element.scopes[0]?.name ?? '',
          heading: element.nearestHeading,
        })),
        model: project.llmModel || undefined,
        temperature: project.llmTemperature,
      },
      options.correlationId,
    );

    const allowed = new Set(offered.map((e) => e.locatorId));
    const out = new Map<string, string>();
    for (const match of response.matches ?? []) {
      const stepId = String(match.testStepId ?? '');
      const locatorId = String(match.locatorId ?? '');
      // The model may only choose from what it was given. A locator id it
      // invented — or one from another project — is dropped here.
      if (stepId && allowed.has(locatorId)) out.set(stepId, locatorId);
    }
    return out;
  }

  // --- assembly -----------------------------------------------------------

  private toResolved(
    binding: CandidateBinding,
    project: Project,
    meta: { source: LocatorResolutionSource; revalidated: boolean },
  ): ResolvedAutomationLocator {
    const { step, match, record } = binding;
    const locatorData = record.locatorData as unknown as LocatorData;
    return {
      projectId: project.id,
      applicationId: applicationIdOf(project),
      testStepId: step.testStepId,
      testCaseId: step.testCaseId,
      sequence: step.sequence,
      action: step.action,
      description: step.description,
      valueReference: step.valueReference,
      pageId: record.pageUrlPattern,
      pageName: record.pageName,
      pageUrlPattern: record.pageUrlPattern,
      pageState: record.pageState || undefined,
      frame: locatorData?.frame ?? null,
      scannedElementId: record.scannedElementId ?? '',
      elementName: record.elementName,
      role: record.role,
      locatorId: record.id,
      locatorVersion: record.version,
      strategy: record.strategy as LocatorStrategy,
      locatorData,
      expression: record.expression,
      pythonExpression: record.pythonExpression || record.expression,
      elementMatchConfidence: round2(match.confidence),
      locatorConfidence: round2(record.confidenceScore),
      validationStatus: record.validationStatus,
      validatedAt: record.lastValidatedAt
        ? new Date(record.lastValidatedAt).toISOString()
        : null,
      source: meta.source,
      awaitingApproval: !record.approved,
      revalidated: meta.revalidated,
      scanId: record.scanId,
      matchRationale: match.rationale,
    };
  }

  private unresolvedStep(
    step: AutomationTestStep,
    reason: string,
    suggestedAction: string,
    consideredElements: string[],
  ): UnresolvedAutomationStep {
    return {
      status: 'NO_APPROVED_MATCH',
      testStepId: step.testStepId,
      testCaseId: step.testCaseId,
      sequence: step.sequence,
      testStep: step.description,
      action: step.action,
      reason,
      suggestedAction,
      consideredElements: consideredElements.slice(0, 5),
    };
  }

  private async isCancelled(options: LocatorResolutionOptions): Promise<boolean> {
    return options.isCancelled ? Boolean(await options.isCancelled()) : false;
  }

  private async assertNotCancelled(options: LocatorResolutionOptions): Promise<void> {
    if (await this.isCancelled(options)) {
      throw new LocatorResolutionCancelled();
    }
  }
}

/** Raised when the caller cancels between resolution phases (§17). */
export class LocatorResolutionCancelled extends Error {
  constructor() {
    super('Locator resolution cancelled');
  }
}

/**
 * The target application a locator belongs to.
 *
 * This platform models one application per project, so the application is
 * identified by the project's base origin — which is also what makes a
 * cross-application locator impossible: the library is queried per project and
 * every page pattern carries its own origin.
 */
export function applicationIdOf(project: Project): string {
  try {
    return new URL(project.baseUrl).origin;
  } catch {
    return project.baseUrl || project.id;
  }
}

/**
 * Prefer an approved locator over an unapproved one for the same control (§2).
 *
 * The matcher scores an element, not an approval state, so two locators for the
 * same element can land within a hair of each other. The ladder is explicit
 * that an approved, human-reviewed locator outranks one that is merely
 * plausible — this is where that is enforced.
 */
function preferApproved(ranked: ElementMatch[], best: ElementMatch): ElementMatch {
  if (best.element.approved) return best;
  const approved = ranked.find(
    (candidate) =>
      candidate.element.approved &&
      candidate.element.elementKey === best.element.elementKey,
  );
  return approved ?? best;
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
