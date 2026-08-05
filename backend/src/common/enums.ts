/**
 * Shared enumerations for the V3 backend (V3 SRS §23.7 status models,
 * FR-V3-ENT-001 roles). Kept as string unions + const arrays so they persist
 * portably as varchar across the Postgres and SQLite drivers.
 */

/**
 * Login roles (FR-V3-ENT-001): Admin, QA Lead, QA Engineer, Automation
 * Engineer, Developer, Reviewer, Viewer. `supervisor` and `devops` remain
 * accepted for accounts created under the V2 contract (`ai_agent` is not a
 * login role).
 */
export const ROLES = [
  'admin',
  'qa_lead',
  'qa_engineer',
  'automation_engineer',
  'developer',
  'reviewer',
  'viewer',
  'supervisor',
  'devops',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Roles obtainable through unauthenticated self-registration (SEC-001,
 * least privilege). Privileged roles — admin, qa_lead, supervisor, devops —
 * can only be granted by an administrator, never claimed at sign-up.
 */
export const SELF_REGISTER_ROLES = [
  'qa_engineer',
  'automation_engineer',
  'developer',
  'reviewer',
  'viewer',
] as const;

/** Document categories (V2_CONTRACT §2 Documents). */
export const DOCUMENT_CATEGORIES = [
  'user_story',
  'epic',
  'srs',
  'api_doc',
  'architecture',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type ProjectStatus = 'active' | 'archived';
export type Runner = 'pytest' | 'playwright-test';

export type JobType =
  | 'analysis'
  | 'test_plan'
  | 'test_cases'
  | 'automation'
  | 'validation'
  | 'report';

/** Generation-job state machine (§23.7 Table 49). */
export const JOB_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type GenerationKind =
  | 'analysis'
  | 'test_plan'
  | 'test_cases'
  | 'automation'
  | 'validation'
  | 'report';

export type ApprovalDecision = 'approved' | 'rejected' | 'regenerate';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ArtifactStatus = 'active' | 'superseded';

/**
 * Artefact lifecycle state (§23.7): Draft, Under Review, Approved, Rejected,
 * Superseded, Archived. Derived from the persisted approval/status columns so
 * existing rows need no migration.
 */
export const ARTEFACT_STATES = [
  'draft',
  'under_review',
  'approved',
  'rejected',
  'superseded',
  'archived',
] as const;
export type ArtefactState = (typeof ARTEFACT_STATES)[number];

/** Validation state machine (§23.7). `pending` is the stored V2 alias of `not_started`. */
export const VALIDATION_STATUSES = [
  'not_started',
  'pending',
  'running',
  'passed',
  'passed_with_warnings',
  'failed',
  'overridden',
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/**
 * Execution-run state machine (§23.7): Queued, Preparing, Running, Stopping,
 * Passed, Failed, Partially Passed, Cancelled, Timed Out. `completed`/`error`
 * remain readable for V2 rows.
 */
export const EXECUTION_STATUSES = [
  'queued',
  'preparing',
  'running',
  'stopping',
  'passed',
  'failed',
  'partially_passed',
  'cancelled',
  'timed_out',
  'completed',
  'error',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ExecutionMode = 'local' | 'ci';

/** Selectable Playwright engines (FR-V3-EXE-003; WebKit is the Safari-compatible engine). */
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type Browser = (typeof BROWSERS)[number];

/** Run scope (FR-V3-EXE-007): Run Selected / Run Failed / Run All. */
export const RUN_SCOPES = ['selected', 'failed', 'all'] as const;
export type RunScope = (typeof RUN_SCOPES)[number];

/** CI/CD run state machine (§23.7). */
export const CI_RUN_STATUSES = [
  'not_triggered',
  'queued',
  'in_progress',
  'successful',
  'failed',
  'cancelled',
] as const;
export type CiRunStatus = (typeof CI_RUN_STATUSES)[number];

/** Failure classifications (FR-V3-RPT-003 adds flaky, test-data and unknown). */
export const FINDING_CLASSIFICATIONS = [
  'app_defect',
  'test_defect',
  'environment',
  'data',
  'flaky',
  'inconclusive',
  'unknown',
] as const;
export type FindingClassification = (typeof FINDING_CLASSIFICATIONS)[number];

/** Resource types that can pass through an approval gate (FR-V3-ENT-002). */
export const APPROVAL_RESOURCE_TYPES = [
  'test_plan',
  'test_case',
  'automation',
  'validation_exception',
  'report',
] as const;
export type ApprovalResourceType = (typeof APPROVAL_RESOURCE_TYPES)[number];

/** Job log severities (FR-V3-LOG, §23.1.1). */
export const LOG_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

/**
 * Execution log levels (§ real-time execution logging). A superset of
 * LogSeverity that adds developer-oriented `debug` and the test-outcome
 * levels `pass`/`fail`, so the live execution console reads like a CI system
 * (Jenkins/GitHub Actions). Each level maps to its own colour in the UI.
 */
export const EXECUTION_LOG_LEVELS = [
  'debug',
  'info',
  'warning',
  'error',
  'success',
  'pass',
  'fail',
] as const;
export type ExecutionLogLevel = (typeof EXECUTION_LOG_LEVELS)[number];

/**
 * Ordered execution lifecycle stages shown in the live log console. Stored as
 * human-readable labels so both the backend logs and the UI use one vocabulary.
 */
export const EXECUTION_STAGES = [
  'Initializing',
  'Preparing Execution',
  'Loading Configuration',
  'Discovering Tests',
  'Launching Browser',
  'Running Tests',
  'Capturing Evidence',
  'Generating Reports',
  'Uploading Results',
  'Completed',
  'Failed',
] as const;
export type ExecutionStage = (typeof EXECUTION_STAGES)[number];

/**
 * UI Scanner lifecycle (FR-UIS-003). One closed vocabulary shared verbatim by
 * the engine (`engine/uiscanner/types.py`), this backend and the React UI, so
 * a stage never has to be translated between tiers.
 */
export const UI_SCAN_STAGES = [
  'IDLE',
  'QUEUED',
  'STARTING_BROWSER',
  'NAVIGATING',
  'AUTHENTICATING',
  'WAITING_FOR_PAGE',
  'SCANNING_DOM',
  'SCANNING_FRAMES',
  'CAPTURING_ACCESSIBILITY',
  'GENERATING_LOCATORS',
  'VALIDATING_LOCATORS',
  'CAPTURING_SCREENSHOT',
  'SAVING_RESULTS',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export type UiScanStage = (typeof UI_SCAN_STAGES)[number];

export const UI_SCAN_TERMINAL_STAGES: readonly UiScanStage[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
];

/** Locator generation strategies, best-first (FR-UIS-009). */
export const LOCATOR_STRATEGIES = [
  'role',
  'label',
  'testId',
  'placeholder',
  'text',
  'scopedRole',
  'name',
  'css',
  'xpath',
] as const;
export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

/** Where a locator came from — deterministic scan, model fallback or a human. */
export const LOCATOR_SOURCES = [
  'deterministic-scanner',
  'llm-fallback',
  'manual',
] as const;
export type LocatorSource = (typeof LOCATOR_SOURCES)[number];

/**
 * Review state of one scanned element / locator (FR-UIS-018). `unique` and
 * `multiple_matches` are produced by validation; the rest are human decisions.
 */
export const LOCATOR_STATUSES = [
  'valid',
  'unique',
  'multiple_matches',
  'invalid',
  'needs_review',
  'approved',
  'rejected',
  'manually_edited',
] as const;
export type LocatorStatus = (typeof LOCATOR_STATUSES)[number];

/**
 * Where a locator handed to automation generation came from (FR-UIS-025 §8).
 *
 * Deliberately separate from `LOCATOR_SOURCES`: that records how the *scanner*
 * produced a locator, this records how *automation generation* obtained it. A
 * model-assisted match of a step to an already-scanned element is
 * `LLM_FALLBACK` even though the locator itself is deterministic — the
 * uncertainty is in the matching, and that is what a reviewer needs to see.
 */
export const LOCATOR_RESOLUTION_SOURCES = [
  'DETERMINISTIC_SCANNER',
  'LLM_FALLBACK',
  'MANUAL_EDIT',
] as const;
export type LocatorResolutionSource =
  (typeof LOCATOR_RESOLUTION_SOURCES)[number];

/**
 * Outcome of resolving one test case's steps against the locator library.
 *
 * There is no review stage: a user's approval of a locator is final, and a
 * step the matcher could not bind is a *diagnostic*, not a gate. Generation
 * and execution proceed either way (FR-UIS-025 §2).
 */
export const LOCATOR_RESOLUTION_STATUSES = [
  'RESOLVED',
  'PARTIALLY_RESOLVED',
  'NO_APPROVED_MATCH',
] as const;
export type LocatorResolutionStatus =
  (typeof LOCATOR_RESOLUTION_STATUSES)[number];

/**
 * Historical resolution statuses mapped onto the current vocabulary.
 *
 * `LOCATOR_REVIEW_REQUIRED` was a blocking stage that no longer exists.
 * Artefacts generated before it was removed still carry it, and they must read
 * as a diagnostic rather than reappear as a gate (§6 backward compatibility).
 */
export function normaliseResolutionStatus(
  status: string | null | undefined,
): LocatorResolutionStatus {
  if (status === 'LOCATOR_REVIEW_REQUIRED') return 'NO_APPROVED_MATCH';
  return (LOCATOR_RESOLUTION_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as LocatorResolutionStatus)
    : 'RESOLVED';
}

/**
 * The interaction a test step performs. Derived deterministically from the
 * step text and used to score role compatibility when matching a step to a
 * scanned element (FR-UIS-025 §3) — a "fill" step can never match a button.
 * `navigate`, `assert` and `wait` carry no UI target of their own.
 */
export const STEP_ACTIONS = [
  'fill',
  'click',
  'check',
  'select',
  'press',
  'hover',
  'upload',
  'navigate',
  'assert',
  'wait',
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

/** Step actions that need a locator; the rest are navigation or waiting. */
export const LOCATOR_BEARING_ACTIONS: readonly StepAction[] = [
  'fill',
  'click',
  'check',
  'select',
  'press',
  'hover',
  'upload',
  'assert',
];

/** In-app notification types (FR-V3-ENT-007). */
export const NOTIFICATION_TYPES = [
  'job.completed',
  'job.failed',
  'approval.requested',
  'execution.finished',
  'ci.result',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** WS/SSE envelope event types (V2_CONTRACT §3 + V3 §23.1/§23.4). */
export type EventType =
  | 'job.progress'
  | 'job.log'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'analysis.ready'
  | 'plan.ready'
  | 'cases.ready'
  | 'automation.ready'
  | 'validation.ready'
  | 'approval.updated'
  | 'execution.step'
  | 'execution.status'
  | 'execution.log'
  | 'ui_scan.status'
  | 'ui_scan.log'
  | 'ui_scan.ready'
  | 'notification.new'
  | 'ci.status';
