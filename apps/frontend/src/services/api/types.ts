/**
 * Domain types mirroring the V2 backend contract (V2_CONTRACT §2, §3, §5).
 * These are the wire shapes the browser exchanges with the backend over
 * `/api/v2/*`. Kept in sync with backend `src/entities/*` and `common/enums.ts`.
 */

// ---- Enums (V2_CONTRACT §1, §5) --------------------------------------------

export type Role =
  | 'superowner'
  | 'admin'
  | 'qa_lead'
  | 'qa_engineer'
  | 'automation_engineer'
  | 'developer'
  | 'reviewer'
  | 'viewer'
  | 'supervisor'
  | 'devops';

export const ROLES: Role[] = [
  'superowner',
  'admin',
  'qa_lead',
  'qa_engineer',
  'automation_engineer',
  'developer',
  'reviewer',
  'viewer',
  'supervisor',
  'devops',
];

/** Roles with platform-wide visibility (mirrors backend isAdminRole). */
export function isAdminRole(role: Role | undefined): boolean {
  return role === 'admin' || role === 'superowner';
}

/** Roles selectable at self-registration (SEC-001 — no privileged roles). */
export const SELF_REGISTER_ROLES: Role[] = [
  'qa_engineer',
  'automation_engineer',
  'developer',
  'reviewer',
  'viewer',
];

export type DocumentCategory =
  | 'user_story'
  | 'epic'
  | 'srs'
  | 'api_doc'
  | 'architecture';

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'user_story',
  'epic',
  'srs',
  'api_doc',
  'architecture',
];

export type ProjectStatus = 'active' | 'archived';
export type Runner = 'pytest' | 'playwright-test';

// ---- LLM configuration (LOCAL Ollama vs CLOUD provider) --------------------

export type LlmType = 'LOCAL' | 'CLOUD';

export interface CloudProviderInfo {
  id: string;
  label: string;
  /** Default OpenAI-compatible endpoint; empty = a custom base URL is required. */
  defaultBaseUrl: string;
  supportsCustomBaseUrl: boolean;
  /** Suggestions only — the model input always accepts free text. */
  exampleModels: string[];
}

/** Mirrors the backend provider registry (common/llm/providers.ts). */
export const CLOUD_PROVIDERS: CloudProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsCustomBaseUrl: false,
    exampleModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    supportsCustomBaseUrl: false,
    exampleModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    supportsCustomBaseUrl: false,
    exampleModels: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4-5'],
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsCustomBaseUrl: false,
    exampleModels: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: '',
    supportsCustomBaseUrl: true,
    exampleModels: [],
  },
];

/** Local (Ollama) model suggestions; the input accepts any pulled model. */
export const LOCAL_MODEL_SUGGESTIONS = [
  'qwen2.5:latest',
  'qwen2.5-coder:latest',
  'qwen3:8b',
  'deepseek-r1:8b',
];

export type JobType =
  | 'analysis'
  | 'test_plan'
  | 'test_cases'
  | 'automation'
  | 'validation'
  | 'report';
/** Generation-job state machine (V3 SRS §23.7). */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type ApprovalDecision = 'approved' | 'rejected' | 'regenerate';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ArtifactStatus = 'active' | 'superseded';
/** Validation state machine (V3 SRS §23.7). */
export type ValidationStatus =
  | 'not_started'
  | 'pending'
  | 'running'
  | 'passed'
  | 'passed_with_warnings'
  | 'failed'
  | 'overridden';
/** Artefact lifecycle state (V3 SRS §23.7), derived server-side. */
export type ArtefactState =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'archived';

/** Execution-run state machine (V3 SRS §23.7). */
export type ExecutionStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'stopping'
  | 'passed'
  | 'failed'
  | 'partially_passed'
  | 'cancelled'
  | 'timed_out'
  | 'completed'
  | 'error';
export type ExecutionMode = 'local' | 'ci';
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';
export type RunScope = 'selected' | 'failed' | 'all';
/** CI/CD run state machine (V3 SRS §23.7). */
export type CiRunStatus =
  | 'not_triggered'
  | 'queued'
  | 'in_progress'
  | 'successful'
  | 'failed'
  | 'cancelled';

export type FindingClassification =
  | 'app_defect'
  | 'test_defect'
  | 'environment'
  | 'data'
  | 'flaky'
  | 'inconclusive'
  | 'unknown';

export type ApprovalResourceType =
  | 'test_plan'
  | 'test_case'
  | 'automation'
  | 'validation_exception'
  | 'report';

/** Live status a UI element can present (FR-FE-003). */
export type UiStatus =
  | 'idle'
  | 'loading'
  | 'queued'
  | 'running'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'error'
  | 'cancelled';

// ---- Realtime envelope (V2_CONTRACT §3) ------------------------------------

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
  | 'notification.new'
  | 'ci.status';

export interface EventEnvelope<P = Record<string, unknown>> {
  type: EventType;
  correlationId: string;
  projectId: string;
  runId?: string;
  jobId?: string;
  seq: number;
  ts: string;
  payload: P;
}

export type ExecutionActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'upload'
  | 'wait'
  | 'assert'
  | 'screenshot'
  | 'error';

export type StepStatus = 'running' | 'passed' | 'failed' | 'skipped';

/** `execution.step` payload (V2_CONTRACT §3, FR-EXE-006/007/008). */
export interface ExecutionStepPayload {
  testCaseId: string;
  testName: string;
  sequence: number;
  actionType: ExecutionActionType;
  target: string;
  valueSummary: string;
  status: StepStatus;
  currentUrl: string;
  elapsedMs: number;
  ts: string;
  evidenceUri?: string;
}

/** `execution.status` payload. */
export interface ExecutionStatusPayload {
  status: ExecutionStatus;
  [k: string]: unknown;
}

/** Real-time execution log levels (each maps to its own colour in the UI). */
export type ExecutionLogLevel =
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'success'
  | 'pass'
  | 'fail';

/** `execution.log` payload — one live, CI-style log line. */
export interface ExecutionLogPayload {
  runId: string;
  seq: number;
  level: ExecutionLogLevel;
  stage: string;
  message: string;
  progress: number | null;
  testCaseId?: string;
  testName?: string;
  meta?: Record<string, unknown>;
  ts: string;
}

/** Persisted execution log row returned by GET /executions/:id/logs. */
export interface ExecutionLogRow {
  id: string;
  executionRunId: string;
  projectId: string;
  seq: number;
  level: ExecutionLogLevel;
  stage: string;
  message: string;
  progress: number | null;
  testCaseId: string;
  testName: string;
  meta: Record<string, unknown> | null;
  /** Explicit UTC ISO timestamp; matches the live payload's `ts`. */
  ts?: string;
  createdAt: string;
}

// ---- Entities (V2_CONTRACT §5) ---------------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  /** false = disabled by the superowner; sign-in is blocked. */
  isActive: boolean;
  createdAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  /** API host for generated API tests; empty = same as baseUrl. */
  apiBaseUrl: string;
  allowedDomains: string;
  repository: string;
  environment: string;
  status: ProjectStatus;
  llmType: LlmType;
  llmModel: string;
  llmTemperature: number;
  cloudProvider: string;
  cloudModel: string;
  cloudBaseUrl: string;
  /** The key itself is never returned by the API — only this presence flag. */
  hasCloudApiKey: boolean;
  runner: Runner;
  /** Zero-pad width for displayed TC IDs; 0 = TC-1 (FR-V3-TC-004). */
  tcZeroPad: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummary {
  documents: number;
  requirements: number;
  analyses: number;
  testPlans: number;
  approvedPlans: number;
  testCases: number;
  approvedCases: number;
  artifacts: number;
  executions: number;
  pendingApprovals: number;
}

export type ProjectWithSummary = Project & { workflowSummary: WorkflowSummary };

/** Result of pushing generated automation to the project's GitHub repo. */
export interface GitPushResult {
  branch: 'main';
  sha: string;
  pushed: boolean;
  mode: 'pushed' | 'no-changes';
  repoUrl: string;
  committed: string[];
  warning?: string;
}

export interface SourceDocument {
  id: string;
  projectId: string;
  filename: string;
  category: DocumentCategory;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: string;
  message: string;
  storagePath: string;
  contentHash: string;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSegment {
  id: string;
  documentId: string;
  sequence: number;
  pageOrSheet: string;
  rowOrSection: string;
  content: string;
  metadata: Record<string, unknown> | null;
  inclusionStatus: 'included' | 'excluded' | string;
  createdAt: string;
}

export interface DocumentPreview {
  document: SourceDocument;
  segments: DocumentSegment[];
}

export interface Requirement {
  id: string;
  projectId: string;
  source: string;
  version: number;
  title: string;
  text: string;
  acceptanceCriteria: string[] | null;
  status: string;
  sourceDocumentId: string | null;
  contentHash: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Analysis {
  id: string;
  projectId: string;
  requirementId: string | null;
  generationRunId: string | null;
  schemaVersion: string;
  contentHash: string;
  riskScore: number;
  output: RequirementAnalysisOutput;
  model: string;
  temperature: number;
  createdBy: string | null;
  createdAt: string;
}

/** RequirementAnalysisOutput (engine schema, FR-RA-*). Fields are best-effort. */
export interface RequirementAnalysisOutput {
  actors?: string[];
  assumptions?: string[];
  gaps?: string[];
  clarificationQuestions?: string[];
  clarification_questions?: string[];
  riskScore?: number;
  risk_score?: number;
  riskRationale?: string;
  summary?: string;
  [k: string]: unknown;
}

export interface TestPlan {
  id: string;
  projectId: string;
  generationRunId: string | null;
  title: string;
  version: number;
  artefactState?: ArtefactState;
  approvalStatus: ApprovalStatus;
  approvalInvalidated: boolean;
  schemaVersion: string;
  contentHash: string;
  sections: Record<string, unknown>;
  model: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  id: string;
  projectId: string;
  generationRunId: string | null;
  requirementIds: string[] | null;
  caseKey: string;
  /** Canonical numeric ID value (FR-V3-TC-001); stable across edits. */
  seq: number;
  /** Human-readable identifier, e.g. TC-12 (FR-V3-TC-001). */
  humanId: string;
  artefactState?: ArtefactState;
  title: string;
  objective: string;
  category: string;
  priority: string;
  preconditions: string[] | null;
  testData: Record<string, string> | null;
  steps: string[] | null;
  expectedResults: string[] | null;
  automationSuitability: string;
  source: string;
  approvalStatus: ApprovalStatus;
  approvalInvalidated: boolean;
  automationStatus: string;
  version: number;
  schemaVersion: string;
  contentHash: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CoverageRequirement {
  requirementId: string;
  title: string;
  testCaseCount: number;
  approvedCount: number;
  covered: boolean;
}

export interface Coverage {
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
  totalTestCases: number;
  perRequirement: CoverageRequirement[];
}

export interface GeneratedArtifact {
  id: string;
  projectId: string;
  generationRunId: string | null;
  testCaseIds: string[] | null;
  path: string;
  kind: string;
  content: string;
  diff: string;
  traceability: Record<string, unknown> | null;
  contentHash: string;
  version: number;
  status: ArtifactStatus;
  supersededById: string | null;
  validationStatus: ValidationStatus;
  validationReport: ValidationReport | null;
  approvalStatus: ApprovalStatus;
  approvalInvalidated: boolean;
  schemaVersion: string;
  /** Kind of generated test — 'ui' (default) or 'api'. */
  testType?: string;
  /** True when the artifact was generated as part of a regression suite. */
  regressionSuite?: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationFinding {
  file?: string;
  path?: string;
  rule?: string;
  severity?: string;
  message?: string;
  line?: number;
  location?: string;
  guidance?: string;
  [k: string]: unknown;
}

export interface ValidationReport {
  status?: ValidationStatus | string;
  findings?: ValidationFinding[];
  summary?: string;
  [k: string]: unknown;
}

export interface ExecutionPlanStep {
  sequence: number;
  actionType: string;
  target: string;
  description: string;
  expected: string;
}

export interface ExecutionPlan {
  plans: Array<{
    testCaseId: string;
    caseKey?: string;
    title?: string;
    steps: ExecutionPlanStep[];
  }>;
}

export interface ExecutionRun {
  id: string;
  projectId: string;
  mode: ExecutionMode;
  status: ExecutionStatus;
  environment: string;
  browser: string;
  headed: boolean;
  automationIds: string[] | null;
  testPaths: string[] | null;
  /** selected | failed | all (FR-V3-EXE-007). */
  runScope: RunScope | string;
  /** Effective runtime settings persisted with the run (FR-V3-EXE-011). */
  settings: ExecutionSettings | null;
  restartOfRunId: string | null;
  metrics: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  ciRunId: string;
  ciUrl: string;
  correlationId: string;
  report: Record<string, unknown> | null;
  /** True when this run is the project's single regression baseline. */
  isBaseline?: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Regression comparisons -------------------------------------------------

/** Engine diff between a baseline run and a candidate run. */
export interface RegressionResult {
  regressions: string[];
  fixes: string[];
  still_failing: string[];
  skipped: string[];
  new_tests: Array<{ node_id: string; status: 'pass' | 'fail' | 'skip' }>;
  missing_tests: string[];
  stable_passes: number;
  summary: {
    baseline_total: number;
    current_total: number;
    regressed: number;
    fixed: number;
    still_failing: number;
    new: number;
    missing: number;
    has_regressions: boolean;
  };
}

export interface RegressionComparison {
  id: string;
  projectId: string;
  baselineRunId: string;
  candidateRunId: string;
  hasRegressions: boolean;
  result: RegressionResult;
  createdBy: string;
  correlationId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ExecutionEventRow {
  id: string;
  executionRunId: string;
  projectId: string | null;
  seq: number;
  type: string;
  testCaseId: string;
  testName: string;
  sequence: number;
  actionType: string;
  target: string;
  valueSummary: string;
  status: string;
  currentUrl: string;
  elapsedMs: number;
  evidenceUri: string;
  ts: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface TestResult {
  id: string;
  executionRunId: string;
  testCaseId: string | null;
  nodeId: string;
  outcome: string;
  durationSeconds: number;
  errorMessage: string;
  evidence: Record<string, unknown> | null;
  createdAt: string;
}

export interface Finding {
  id: string;
  projectId: string;
  executionRunId: string | null;
  testResultId: string | null;
  classification: FindingClassification;
  confidence: number;
  rationale: string;
  severity: string;
  overridden: boolean;
  overrideReason: string;
  defectDraft: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  projectId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  resourceVersion: number;
  decision: ApprovalDecision;
  comment: string;
  invalidated: boolean;
  actorId: string | null;
  actor: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  projectId: string | null;
  result: string;
  correlationId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  correlationId: string;
  idempotencyKey: string | null;
  inputRefs: Record<string, unknown> | null;
  resultRefs: Record<string, unknown> | null;
  error: string;
  cancelRequested: boolean;
  retryOfJobId: string | null;
  currentStage: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 202 response returned by every async generate endpoint. */
export interface JobAccepted {
  jobId: string;
  status: JobStatus;
}

export interface HealthStatus {
  status: string;
  api: string;
  database: string;
  engine: string;
  ollama: string;
}

// ---- Request payloads ------------------------------------------------------

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  baseUrl?: string;
  /** API host for generated API tests; empty = same as baseUrl. */
  apiBaseUrl?: string;
  allowedDomains?: string;
  repository?: string;
  environment?: string;
  llmType?: LlmType;
  llmModel?: string;
  llmTemperature?: number;
  cloudProvider?: string;
  cloudModel?: string;
  /** Write-only: sealed server-side; blank on update keeps the saved key. */
  cloudApiKey?: string;
  cloudBaseUrl?: string;
  runner?: Runner;
  tcZeroPad?: number;
}

export type UpdateProjectInput = Partial<
  CreateProjectInput & { status: ProjectStatus }
>;

export interface ExecutionSettings {
  timeoutSeconds?: number;
  retries?: number;
  workers?: number;
  slowMoMs?: number;
  screenshotMode?: 'on-failure' | 'every-test' | 'off';
  video?: boolean;
}

export interface CreateExecutionInput {
  projectId: string;
  automationIds?: string[];
  testPaths?: string[];
  browser?: BrowserEngine | string;
  headed?: boolean;
  environment?: string;
  runScope?: RunScope;
  settings?: ExecutionSettings;
}

// ---- V3 additions (§23.1/§23.2/§23.4/§23.5) ----------------------------

export type LogSeverity = 'info' | 'success' | 'warning' | 'error';

/** Persisted live-log entry for a job (FR-V3-LOG-001..008). */
export interface JobLogEntry {
  id: string;
  jobId: string;
  projectId: string;
  seq: number;
  stage: string;
  message: string;
  severity: LogSeverity;
  progress: number | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** `job.log` WS payload. */
export interface JobLogPayload {
  jobId: string;
  type: JobType;
  seq: number;
  stage: string;
  message: string;
  severity: LogSeverity;
  progress: number | null;
  meta?: Record<string, unknown>;
  ts: string;
}

/** Test plan revision v{int} (FR-V3-TP-001/002). */
export interface TestPlanRevision {
  id: string;
  testPlanId: string;
  projectId: string;
  version: number;
  title: string;
  sections: Record<string, unknown>;
  contentHash: string;
  sourceAction: string;
  changeSummary: string;
  approvalStatus: ApprovalStatus;
  author: string;
  authorId: string | null;
  createdAt: string;
}

export interface RevisionSectionDiff {
  section: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  from: unknown;
  to: unknown;
}

export interface RevisionComparison {
  from: TestPlanRevision;
  to: TestPlanRevision;
  sections: RevisionSectionDiff[];
}

export type NotificationType =
  | 'job.completed'
  | 'job.failed'
  | 'approval.requested'
  | 'execution.finished'
  | 'ci.result';

/** In-app notification (FR-V3-ENT-007). */
export interface AppNotification {
  id: string;
  userId: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: string;
  resourceId: string;
  read: boolean;
  createdAt: string;
}

/** V3 report counts (FR-V3-RPT-001). */
export interface ReportCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  flaky: number;
  notRun: number;
  passRate: number;
}

/** Project dashboard (FR-V3-ENT-003). */
export interface ProjectDashboard {
  workflowSummary: WorkflowSummary;
  pendingApprovals: Array<{
    resourceType: string;
    resourceId: string;
    title: string;
    version: number;
  }>;
  recentRuns: Array<{
    id: string;
    status: ExecutionStatus;
    browser: string;
    headed: boolean;
    mode: ExecutionMode;
    runScope: string;
    startedAt: string | null;
    finishedAt: string | null;
    metrics: Record<string, unknown> | null;
  }>;
  passRate: { total: number; passed: number; failed: number; percent: number };
  defects: number;
  recentActivity: AuditEvent[];
}

/** Standard error contract (FR-BE-001). */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
}
