import {
  LocatorResolutionSource,
  LocatorResolutionStatus,
  LocatorStatus,
  LocatorStrategy,
  StepAction,
} from '../../common/enums';
import { FrameDefinition, LocatorData } from '../ui-scanner/ui-scanner.types';

/**
 * The locator-resolution contract between the UI Scanner library and
 * automation generation (FR-UIS-025 §8).
 *
 * The generator never receives raw HTML or an instruction to write a selector.
 * It receives *these*: a locator that already exists, was validated against the
 * running application, and carries the identity (id + version) needed to trace
 * the generated line back to the scan it came from.
 */

/** One test step as automation generation sees it. */
export interface AutomationTestStep {
  testStepId: string;
  testCaseId: string;
  /** 1-based position of the step inside its test case. */
  sequence: number;
  /** The step text, verbatim, as written in the approved test case. */
  description: string;
  action: StepAction;
  /** Whether the step drives a UI element and therefore needs a locator. */
  requiresLocator: boolean;
  /**
   * Fixture-backed value the generated code should use, e.g.
   * `credentials.username`. Never a literal credential (FR-AUT-005).
   */
  valueReference?: string;
  /** What kind of data the step supplies (email, password, date, …). */
  testDataType?: string;
  /** Page the step is expected to act on, when the case says so. */
  pageName?: string;
  pageUrlPattern?: string;
  /**
   * Frame the step acts in, as the joined iframe-selector chain. Supplied by
   * the caller (the resolve API, or a preceding step that entered a frame);
   * an omitted value means "any frame", an empty string means the main
   * document specifically.
   */
  frameKey?: string;
  /** Page state the step runs in, e.g. `dialog:Confirm delete`. */
  pageState?: string;
  /** Container named in the step, e.g. "in the Profile section". */
  parentContext?: string;
  /** Quoted or capitalised element name lifted out of the step text. */
  targetPhrase?: string;
}

/** A locator resolved for one step — the payload the generator is given. */
export interface ResolvedAutomationLocator {
  projectId: string;
  /** The target application. This platform models one application per
   * project, so the application is identified by the project's base origin. */
  applicationId: string;

  testStepId: string;
  testCaseId: string;
  sequence: number;
  action: StepAction;
  description: string;
  valueReference?: string;

  pageId: string;
  pageName: string;
  pageUrlPattern: string;
  pageState?: string;
  frame?: FrameDefinition | null;

  scannedElementId: string;
  elementName: string;
  role: string;

  locatorId: string;
  locatorVersion: number;
  strategy: LocatorStrategy;
  locatorData: LocatorData;
  /** Displayable TypeScript Playwright code. */
  expression: string;
  /** The same locator as sync-Python code — the form this repo's tests use. */
  pythonExpression: string;

  elementMatchConfidence: number;
  locatorConfidence: number;
  validationStatus: LocatorStatus;
  validatedAt: string | null;
  source: LocatorResolutionSource;

  /** True when the locator is valid but has not been approved yet (§2.3). */
  awaitingApproval: boolean;
  /** True when this generation request re-validated it against the page. */
  revalidated: boolean;
  scanId: string | null;
  /** Why the matcher chose this element — shown as provenance, never executed. */
  matchRationale: Record<string, unknown>;
}

/**
 * A step no approved locator could be matched to (§11).
 *
 * This is a diagnostic, not a workflow stage: it never blocks generation and
 * never blocks execution. It exists so the user can see which step needs a
 * scan, and nothing more.
 */
export interface UnresolvedAutomationStep {
  status: 'NO_APPROVED_MATCH';
  testStepId: string;
  testCaseId: string;
  sequence: number;
  testStep: string;
  action: StepAction;
  reason: string;
  suggestedAction: string;
  /** Element names that were considered and rejected, for the diagnostic. */
  consideredElements: string[];
}

/** Where the time went, per resolution request (§17). */
export interface LocatorResolutionTimings {
  lookupMs: number;
  matchingMs: number;
  revalidationMs: number;
  llmFallbackMs: number;
  rescanMs: number;
  totalMs: number;
}

/** The result of resolving one test case's steps. */
export interface LocatorResolutionResult {
  testCaseId: string;
  caseKey: string;
  status: LocatorResolutionStatus;
  resolvedSteps: ResolvedAutomationLocator[];
  unresolvedSteps: UnresolvedAutomationStep[];
  timings: LocatorResolutionTimings;
  /** Locators re-validated during this request, by id. */
  revalidatedLocatorIds: string[];
  /** Non-fatal notes for the job log (stale scan, no scan at all, …). */
  warnings: string[];
}

/** Options that control how hard resolution tries before giving up. */
export interface LocatorResolutionOptions {
  /**
   * Re-open the target page to re-validate stale or uncertain locators (§5).
   * On by default; a caller that only wants a dry lookup turns it off.
   */
  revalidate?: boolean;
  /**
   * Run a targeted single-page rescan for steps nothing matched (§2.4).
   * Off by default for interactive generation: a rescan launches a browser and
   * can take a minute, which is a decision the caller should make explicitly.
   */
  allowTargetedRescan?: boolean;
  /** Ask the model to match leftover steps to *scanned* elements (§2.5). */
  allowLlmMatching?: boolean;
  /** Minimum element-match confidence a deterministic match must reach. */
  minMatchConfidence?: number;
  /** Minimum locator confidence a record must carry to be generated from. */
  minLocatorConfidence?: number;
  /** Credentials for revalidation, when the page needs a session (§5.2). */
  auth?: {
    loginUrl?: string;
    username?: string;
    password?: string;
    storageStateId?: string;
  };
  /** Cooperative cancellation, checked between phases (§17). */
  isCancelled?: () => boolean | Promise<boolean>;
  correlationId?: string;
}
