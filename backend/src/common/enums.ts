/**
 * Shared enumerations for the V2 backend (V2_CONTRACT §1, §2, §5).
 * Kept as string unions + const arrays so they persist portably as varchar
 * across the Postgres and SQLite drivers.
 */

/** Login roles (V2_CONTRACT §1; `ai_agent` is not a login role). */
export const ROLES = [
  'qa_engineer',
  'automation_engineer',
  'developer',
  'supervisor',
  'devops',
  'admin',
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

export type JobType = 'analysis' | 'test_plan' | 'test_cases' | 'automation';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type GenerationKind = 'analysis' | 'test_plan' | 'test_cases' | 'automation';

export type ApprovalDecision = 'approved' | 'rejected' | 'regenerate';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ArtifactStatus = 'active' | 'superseded';
export type ValidationStatus = 'pending' | 'passed' | 'failed';

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';
export type ExecutionMode = 'local' | 'ci';

export type FindingClassification =
  | 'app_defect'
  | 'test_defect'
  | 'environment'
  | 'data'
  | 'inconclusive';

/** Resource types that can pass through an approval gate (V2_CONTRACT §2). */
export const APPROVAL_RESOURCE_TYPES = [
  'test_plan',
  'test_case',
  'automation',
] as const;
export type ApprovalResourceType = (typeof APPROVAL_RESOURCE_TYPES)[number];

/** WS/SSE envelope event types (V2_CONTRACT §3). */
export type EventType =
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'analysis.ready'
  | 'plan.ready'
  | 'cases.ready'
  | 'automation.ready'
  | 'validation.ready'
  | 'approval.updated'
  | 'execution.step'
  | 'execution.status'
  | 'ci.status';
