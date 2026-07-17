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
  | 'notification.new'
  | 'ci.status';
