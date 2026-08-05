import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LocatorRecord, StepLocatorReference } from '../../entities';
import { LocatorStorageService } from './locator-storage.service';

/**
 * Locator traceability and usage metrics (FR-UIS-025 §9, §15).
 *
 * Two jobs, deliberately in one place because they share the same rows:
 *
 * * **Traceability** — after generation, one row per generated UI interaction
 *   linking the Playwright line back through test step → scanned element →
 *   locator → version → scan. Written in bulk, never one insert per step.
 * * **Metrics** — how often a locator is generated into a suite and how it
 *   behaves when that suite runs.
 *
 * The execution side is careful about blame. A test can fail because the
 * application is broken, because an assertion is wrong, because the backend
 * timed out or because the data was bad — none of which says anything about
 * the locator. Only a failure where the locator itself could not resolve the
 * intended element is recorded as a locator failure.
 */
@Injectable()
export class LocatorUsageService {
  private readonly logger = new Logger(LocatorUsageService.name);

  constructor(
    @InjectRepository(StepLocatorReference)
    private readonly references: Repository<StepLocatorReference>,
    @InjectRepository(LocatorRecord)
    private readonly locators: Repository<LocatorRecord>,
    private readonly storage: LocatorStorageService,
  ) {}

  /**
   * Persist the step→locator references of one generation run and bump the
   * generation-side metrics (§9, §15).
   *
   * Bulk on both sides: one insert for the references, one update per distinct
   * locator, regardless of how many steps used it.
   */
  async recordGeneration(
    projectId: string,
    references: Omit<StepLocatorReference, 'id' | 'createdAt'>[],
  ): Promise<StepLocatorReference[]> {
    if (!references.length) return [];
    const rows = await this.references.save(
      references.map((r) => this.references.create(r)),
    );

    const byLocator = new Map<string, Omit<StepLocatorReference, 'id' | 'createdAt'>[]>();
    for (const reference of references) {
      if (!reference.locatorId) continue;
      const bucket = byLocator.get(reference.locatorId) ?? [];
      bucket.push(reference);
      byLocator.set(reference.locatorId, bucket);
    }

    const now = new Date();
    for (const [locatorId, uses] of byLocator) {
      const last = uses[uses.length - 1]!;
      await this.locators.increment({ id: locatorId }, 'usageCount', uses.length);
      await this.locators.update(
        { id: locatorId },
        {
          lastUsedAt: now,
          lastUsedAutomationId: last.generatedAutomationId || null,
          lastUsedTestCaseId: last.testCaseId || null,
          lastUsedTestStepId: last.testStepId || null,
        },
      );
    }
    this.storage.invalidate(projectId);
    return rows;
  }

  /** Every locator reference of one generated artefact (Automation Code tab). */
  async forArtifact(
    projectId: string,
    generatedFileId: string,
  ): Promise<StepLocatorReference[]> {
    return this.references.find({
      where: { projectId, generatedFileId },
      order: { stepSequence: 'ASC' },
    });
  }

  /** Every locator reference of one generation run. */
  async forGeneration(
    projectId: string,
    generatedAutomationId: string,
  ): Promise<StepLocatorReference[]> {
    return this.references.find({
      where: { projectId, generatedAutomationId },
      order: { stepSequence: 'ASC' },
    });
  }

  /** Where one locator is used, and how it has behaved (§16 `/usage`). */
  async usageOf(
    projectId: string,
    locatorId: string,
  ): Promise<{
    locatorId: string;
    usageCount: number;
    lastUsedAt: string | null;
    executionSuccessCount: number;
    executionFailureCount: number;
    lastExecutedAt: string | null;
    lastFailureReason: string;
    locatorFailure: boolean;
    references: StepLocatorReference[];
  } | null> {
    const locator = await this.storage.findById(projectId, locatorId);
    if (!locator) return null;
    const references = await this.references.find({
      where: { projectId, locatorId },
      order: { resolvedAt: 'DESC' },
      take: 200,
    });
    return {
      locatorId,
      usageCount: locator.usageCount,
      lastUsedAt: locator.lastUsedAt ? locator.lastUsedAt.toISOString() : null,
      executionSuccessCount: locator.executionSuccessCount,
      executionFailureCount: locator.executionFailureCount,
      lastExecutedAt: locator.lastExecutedAt
        ? locator.lastExecutedAt.toISOString()
        : null,
      lastFailureReason: locator.lastFailureReason,
      locatorFailure: locator.locatorFailure,
      references,
    };
  }

  /**
   * Fold one execution's per-test outcomes into the locator metrics (§15).
   *
   * Results arrive per test, not per step, so every locator the test's
   * artefacts were generated from shares the verdict. A pass credits all of
   * them; a failure only counts against them when the error says the locator
   * failed to resolve — see {@link isLocatorFailure}.
   */
  async recordExecutionOutcome(
    projectId: string,
    results: {
      artifactIds?: string[];
      testCaseIds?: string[];
      outcome: string;
      errorMessage?: string;
    }[],
  ): Promise<{ updated: number; locatorFailures: number }> {
    const artifactIds = new Set<string>();
    const testCaseIds = new Set<string>();
    for (const result of results) {
      for (const id of result.artifactIds ?? []) artifactIds.add(id);
      for (const id of result.testCaseIds ?? []) testCaseIds.add(id);
    }
    if (!artifactIds.size && !testCaseIds.size) return { updated: 0, locatorFailures: 0 };

    const where: Record<string, unknown>[] = [];
    if (artifactIds.size) where.push({ projectId, generatedFileId: In([...artifactIds]) });
    if (testCaseIds.size) where.push({ projectId, testCaseId: In([...testCaseIds]) });
    const references = await this.references.find({ where });
    if (!references.length) return { updated: 0, locatorFailures: 0 };

    // A locator is only implicated by the results that actually cover it.
    const locatorsFor = (
      result: { artifactIds?: string[]; testCaseIds?: string[] },
    ): string[] =>
      references
        .filter(
          (ref) =>
            (result.artifactIds ?? []).includes(ref.generatedFileId ?? '') ||
            (result.testCaseIds ?? []).includes(ref.testCaseId),
        )
        .map((ref) => ref.locatorId);

    const now = new Date();
    let updated = 0;
    let locatorFailures = 0;
    const passed = new Set<string>();
    const failed = new Map<string, string>();

    for (const result of results) {
      const ids = new Set(locatorsFor(result));
      if (!ids.size) continue;
      if (result.outcome === 'passed') {
        for (const id of ids) passed.add(id);
        continue;
      }
      if (result.outcome !== 'failed' && result.outcome !== 'error') continue;
      const reason = result.errorMessage ?? '';
      // Application defects, assertion failures, backend errors and test-data
      // problems are not the locator's fault and must not be recorded as such.
      if (!isLocatorFailure(reason)) continue;
      for (const id of ids) failed.set(id, reason);
    }

    for (const id of passed) {
      if (failed.has(id)) continue; // a failure in the same run wins
      await this.locators.increment({ id }, 'executionSuccessCount', 1);
      await this.locators.update(
        { id },
        { lastExecutedAt: now, locatorFailure: false, lastFailureReason: '' },
      );
      updated += 1;
    }
    for (const [id, reason] of failed) {
      await this.locators.increment({ id }, 'executionFailureCount', 1);
      await this.locators.update(
        { id },
        {
          lastExecutedAt: now,
          locatorFailure: true,
          lastFailureReason: reason.slice(0, 500),
        },
      );
      updated += 1;
      locatorFailures += 1;
    }

    if (updated) this.storage.invalidate(projectId);
    this.logger.log(
      `execution metrics updated for ${updated} locator(s); ${locatorFailures} locator-related failure(s)`,
    );
    return { updated, locatorFailures };
  }
}

/**
 * Whether a failure message means *the locator* failed (§15).
 *
 * Playwright is specific about this: a locator that resolves nothing, resolves
 * too much, or times out waiting for its element says so in the message. An
 * assertion mismatch, an HTTP error or a data problem does not, and must not
 * be charged to the locator — otherwise every flaky backend would slowly mark
 * a perfectly good locator as broken.
 */
export function isLocatorFailure(message: string): boolean {
  const text = (message || '').toLowerCase();
  if (!text) return false;
  const assertionish = [
    'to have text',
    'to contain text',
    'to have url',
    'to have title',
    'to have value',
    'expected string',
    'assertionerror',
  ];
  if (assertionish.some((needle) => text.includes(needle))) return false;
  const locatorish = [
    /strict mode violation/,
    /resolved to (?:\d+|no) elements?/,
    /element is not attached/,
    /no element matching/,
    /waiting for locator/,
    /locator\.\w+: *timeout/,
    /unable to find element/,
  ];
  return locatorish.some((pattern) => pattern.test(text));
}
