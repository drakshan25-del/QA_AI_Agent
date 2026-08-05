import {
  LocatorSource,
  LocatorStatus,
  LocatorStrategy,
  UiScanStage,
} from '../../common/enums';

/**
 * Shared UI Scanner types (FR-UIS-010).
 *
 * `LocatorData` is the only representation the system ever *executes*: the
 * engine rebuilds it through the Playwright API. The rendered `expression`
 * strings that travel alongside it are for humans and for generated code, and
 * are never parsed or evaluated (SEC-005).
 */

/** Where an element lives, as a rebuildable chain of iframe selectors. */
export interface FrameDefinition {
  /** Ordered iframe selectors from the main document down to the element. */
  path: string[];
  url: string;
  name: string;
  title: string;
  selector: string;
  parentIndex: number;
  index: number;
  elementCount?: number;
}

/** One link in a locator chain. */
export interface LocatorDefinition {
  strategy: LocatorStrategy;
  role?: string | null;
  name?: string | null;
  exact?: boolean;
  value?: string | null;
  selector?: string | null;
  /** Which test-id attribute a `testId` locator uses. */
  attribute?: string | null;
  /** Container a scoped locator is anchored in. */
  parent?: LocatorDefinition;
  /** Target inside the container of a scoped locator. */
  child?: LocatorDefinition;
}

/** A complete, executable locator description including its frame chain. */
export interface LocatorData extends LocatorDefinition {
  frame?: FrameDefinition | null;
}

/** One generated, validated and scored locator candidate (§10). */
export interface LocatorCandidate {
  id: string;
  strategy: LocatorStrategy;
  /** Displayable Playwright code (TypeScript form). */
  expression: string;
  /** The same locator as sync-Python code. */
  pythonExpression: string;
  locatorData: LocatorData;
  baseScore: number;
  finalScore: number;
  confidence: number;
  matchCount: number;
  unique: boolean;
  valid: boolean;
  visibleMatch?: boolean | null;
  enabledMatch?: boolean | null;
  roleMatch?: boolean | null;
  nameMatch?: boolean | null;
  identityMatch?: boolean | null;
  reasons: string[];
  warnings: string[];
  source: LocatorSource;
}

/** Research metrics recorded per scan (§29). */
export interface UiScanMetrics {
  totalElements: number;
  uniqueLocators: number;
  unresolvedElements: number;
  uniqueLocatorRate: number;
  semanticLocatorRate: number;
  testIdLocatorRate: number;
  cssFallbackRate: number;
  xpathFallbackRate: number;
  averageCandidatesPerElement: number;
  locatorGenerationSuccessRate: number;
  validationDurationMs: number;
  llmFallbackCount: number;
  llmFallbackAccepted: number;
  llmFallbackRate: number;
  llmDurationMs: number;
  warningCount: number;
  errorCount: number;
  /** Filled in by the backend from persisted approvals. */
  approvalRate?: number;
  averageConfidence?: number;
  scanDurationMs?: number;
}

/** Structured failure envelope returned to the frontend (§27). */
export interface UiScanErrorDetail {
  code: string;
  message: string;
  scanId: string;
  stage: UiScanStage;
  recoverable: boolean;
}

/** `ui_scan.status` WS payload. */
export interface UiScanStatusPayload {
  scanId: string;
  projectId: string;
  stage: UiScanStage;
  progress: number;
  message: string;
  totalElements?: number;
  validLocatorCount?: number;
  unresolvedCount?: number;
  frameCount?: number;
  warningCount?: number;
  errorCount?: number;
}

/** Result of re-validating one stored locator against the live page (§11). */
export interface LocatorValidationOutcome {
  id: string;
  matchCount: number;
  unique: boolean;
  valid: boolean;
  visible: boolean;
  enabled: boolean;
  status: LocatorStatus;
  error?: string;
}
