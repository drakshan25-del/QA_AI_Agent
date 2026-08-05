/**
 * Typed API surface over the backend contract (V2_CONTRACT §2). Every function
 * returns the parsed response body. Grouped by resource; consumed by the
 * react-query hooks in the feature folders.
 */
import { http } from './client';
import type {
  Analysis,
  AppNotification,
  Approval,
  AuditEvent,
  Coverage,
  CreateExecutionInput,
  CreateProjectInput,
  DocumentPreview,
  ExecutionEventRow,
  ExecutionLogRow,
  ExecutionPlan,
  ExecutionRun,
  JobLogEntry,
  ProjectDashboard,
  RevisionComparison,
  TestPlanRevision,
  Finding,
  GeneratedArtifact,
  HealthStatus,
  Job,
  JobAccepted,
  LoginResponse,
  Paginated,
  Project,
  ProjectWithSummary,
  PublicUser,
  Requirement,
  Role,
  SourceDocument,
  TestCase,
  TestPlan,
  TestResult,
  UpdateProjectInput,
  ValidationReport,
  ApprovalDecision,
  ApprovalResourceType,
  FindingClassification,
  LocatorData,
  LocatorRecord,
  LocatorResolutionResult,
  ProjectLocatorMetrics,
  ScannedElement,
  StartUiScanInput,
  StepLocatorReference,
  UiScan,
  UiScanLogRow,
} from './types';

// ---- Auth (V2_CONTRACT §2 Auth) --------------------------------------------

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const { data } = await http.post<LoginResponse>('/auth/login', { email, password });
    return data;
  },
  async register(input: {
    email: string;
    password: string;
    role?: Role;
    name?: string;
  }): Promise<PublicUser> {
    const { data } = await http.post<PublicUser>('/auth/register', input);
    return data;
  },
  async refresh(): Promise<{ accessToken: string }> {
    const { data } = await http.post<{ accessToken: string }>('/auth/refresh', {});
    return data;
  },
  async logout(): Promise<void> {
    await http.post('/auth/logout', {});
  },
  async me(): Promise<PublicUser> {
    const { data } = await http.get<PublicUser>('/auth/me');
    return data;
  },
};

// ---- Projects (FR-PROJ-*) --------------------------------------------------

export const projectsApi = {
  async list(): Promise<Project[]> {
    const { data } = await http.get<Project[]>('/projects');
    return data;
  },
  async get(id: string): Promise<ProjectWithSummary> {
    const { data } = await http.get<ProjectWithSummary>(`/projects/${id}`);
    return data;
  },
  async create(input: CreateProjectInput): Promise<Project> {
    const { data } = await http.post<Project>('/projects', input);
    return data;
  },
  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const { data } = await http.patch<Project>(`/projects/${id}`, input);
    return data;
  },
  async metrics(id: string): Promise<Record<string, unknown>> {
    const { data } = await http.get<Record<string, unknown>>(`/projects/${id}/metrics`);
    return data;
  },
  async exportProject(id: string): Promise<Record<string, unknown>> {
    const { data } = await http.get<Record<string, unknown>>(`/projects/${id}/export`);
    return data;
  },
  /** Project dashboard (FR-V3-ENT-003). */
  async dashboard(id: string): Promise<ProjectDashboard> {
    const { data } = await http.get<ProjectDashboard>(`/projects/${id}/dashboard`);
    return data;
  },
};

// ---- Documents (FR-IN-*) ---------------------------------------------------

export interface UploadedDocResult {
  id?: string;
  filename: string;
  category: string;
  parseStatus?: string;
  parse_status?: string;
  message?: string;
  [k: string]: unknown;
}

export const documentsApi = {
  /** Multipart multi-file upload with per-file categories and progress. */
  async upload(
    projectId: string,
    files: File[],
    categories: string[],
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<{ documents: UploadedDocResult[] }> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    form.append('categories', JSON.stringify(categories));
    const { data } = await http.post<{ documents: UploadedDocResult[] }>(
      `/projects/${projectId}/documents`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal,
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      },
    );
    return data;
  },
  async list(projectId: string): Promise<SourceDocument[]> {
    const { data } = await http.get<SourceDocument[]>(`/projects/${projectId}/documents`);
    return data;
  },
  async get(id: string): Promise<SourceDocument> {
    const { data } = await http.get<SourceDocument>(`/documents/${id}`);
    return data;
  },
  async preview(id: string): Promise<DocumentPreview> {
    const { data } = await http.get<DocumentPreview>(`/documents/${id}/preview`);
    return data;
  },
  async updateSegments(
    id: string,
    segments: Array<{ id: string; inclusionStatus: string }>,
  ): Promise<DocumentPreview> {
    const { data } = await http.patch<DocumentPreview>(`/documents/${id}/segments`, {
      segments,
    });
    return data;
  },
  async remove(id: string): Promise<void> {
    await http.delete(`/documents/${id}`);
  },
};

// ---- Requirements (FR-IN-001/006) ------------------------------------------

export const requirementsApi = {
  async list(projectId: string): Promise<Requirement[]> {
    const { data } = await http.get<Requirement[]>(`/projects/${projectId}/requirements`);
    return data;
  },
  async create(
    projectId: string,
    input: {
      title?: string;
      text: string;
      acceptanceCriteria?: string[];
      source?: string;
    },
  ): Promise<Requirement> {
    const { data } = await http.post<Requirement>(
      `/projects/${projectId}/requirements`,
      input,
    );
    return data;
  },
  async get(id: string): Promise<Requirement> {
    const { data } = await http.get<Requirement>(`/requirements/${id}`);
    return data;
  },
  async history(id: string): Promise<Requirement[]> {
    const { data } = await http.get<Requirement[]>(`/requirements/${id}/history`);
    return data;
  },
  async versions(id: string): Promise<Requirement[]> {
    const { data } = await http.get<Requirement[]>(`/requirements/${id}/versions`);
    return data;
  },
};

// ---- Analysis (FR-RA-*) ----------------------------------------------------

export const analysisApi = {
  async createJob(
    projectId: string,
    input: { documentIds?: string[]; requirementIds?: string[] },
  ): Promise<JobAccepted> {
    const { data } = await http.post<JobAccepted>(
      `/projects/${projectId}/analysis-jobs`,
      input,
    );
    return data;
  },
  async list(projectId: string): Promise<Analysis[]> {
    const { data } = await http.get<Analysis[]>(`/projects/${projectId}/analyses`);
    return data;
  },
  async get(id: string): Promise<Analysis> {
    const { data } = await http.get<Analysis>(`/analyses/${id}`);
    return data;
  },
};

// ---- Test plans (FR-TP-*) --------------------------------------------------

export const testPlansApi = {
  async generate(projectId: string): Promise<JobAccepted> {
    const { data } = await http.post<JobAccepted>(
      `/projects/${projectId}/test-plans/generate`,
      {},
    );
    return data;
  },
  async list(projectId: string): Promise<TestPlan[]> {
    const { data } = await http.get<TestPlan[]>(`/projects/${projectId}/test-plans`);
    return data;
  },
  async get(id: string): Promise<TestPlan> {
    const { data } = await http.get<TestPlan>(`/test-plans/${id}`);
    return data;
  },
  async update(id: string, sections: Record<string, unknown>): Promise<TestPlan> {
    const { data } = await http.patch<TestPlan>(`/test-plans/${id}`, { sections });
    return data;
  },
  async approve(
    id: string,
    decision: ApprovalDecision,
    comment?: string,
  ): Promise<{ id: string; approvalStatus: string; version: number }> {
    const { data } = await http.post(`/test-plans/${id}/approval`, { decision, comment });
    return data as { id: string; approvalStatus: string; version: number };
  },
  exportUrl(id: string, format: 'md' | 'json' | 'docx' | 'pdf'): string {
    return `/test-plans/${id}/export?format=${format}`;
  },
  /** Revision history v1, v2, v3 ... (FR-V3-TP-001/002/003). */
  async revisions(id: string): Promise<TestPlanRevision[]> {
    const { data } = await http.get<TestPlanRevision[]>(`/test-plans/${id}/revisions`);
    return data;
  },
  async compareRevisions(
    id: string,
    from: number,
    to: number,
  ): Promise<RevisionComparison> {
    const { data } = await http.get<RevisionComparison>(
      `/test-plans/${id}/revisions/compare`,
      { params: { from, to } },
    );
    return data;
  },
  async restoreRevision(id: string, version: number): Promise<TestPlan> {
    const { data } = await http.post<TestPlan>(
      `/test-plans/${id}/revisions/${version}/restore`,
      {},
    );
    return data;
  },
};

// ---- Test cases (FR-TC-*) --------------------------------------------------

export interface TestCaseFilter {
  source?: string;
  priority?: string;
  type?: string;
  approval?: string;
  automation?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const testCasesApi = {
  async generate(projectId: string, requirementIds: string[]): Promise<JobAccepted> {
    const { data } = await http.post<JobAccepted>(
      `/projects/${projectId}/test-cases/generate`,
      { requirementIds },
    );
    return data;
  },
  async list(projectId: string, filter: TestCaseFilter): Promise<Paginated<TestCase>> {
    const { data } = await http.get<Paginated<TestCase>>(
      `/projects/${projectId}/test-cases`,
      { params: filter },
    );
    return data;
  },
  async get(id: string): Promise<TestCase> {
    const { data } = await http.get<TestCase>(`/test-cases/${id}`);
    return data;
  },
  async update(id: string, patch: Partial<TestCase>): Promise<TestCase> {
    const { data } = await http.patch<TestCase>(`/test-cases/${id}`, patch);
    return data;
  },
  async approve(
    ids: string[],
    decision: ApprovalDecision,
    comment?: string,
  ): Promise<Array<{ id: string; approvalStatus: string; version: number }>> {
    const { data } = await http.post('/test-cases/approval', { ids, decision, comment });
    return data as Array<{ id: string; approvalStatus: string; version: number }>;
  },
  async coverage(projectId: string): Promise<Coverage> {
    const { data } = await http.get<Coverage>(`/projects/${projectId}/coverage`);
    return data;
  },
};

// ---- Automation (FR-AUT-*) -------------------------------------------------

export const automationApi = {
  async generate(
    projectId: string,
    testCaseIds: string[],
    draftPreview?: boolean,
  ): Promise<JobAccepted> {
    const { data } = await http.post<JobAccepted>(
      `/projects/${projectId}/automation/generate`,
      { testCaseIds, draftPreview },
    );
    return data;
  },
  async list(projectId: string): Promise<GeneratedArtifact[]> {
    const { data } = await http.get<GeneratedArtifact[]>(`/projects/${projectId}/automation`);
    return data;
  },
  async get(id: string): Promise<GeneratedArtifact> {
    const { data } = await http.get<GeneratedArtifact>(`/automation/${id}`);
    return data;
  },
  /** Save an in-place edit of the generated script (AC-004). */
  async update(id: string, content: string): Promise<GeneratedArtifact> {
    const { data } = await http.patch<GeneratedArtifact>(`/automation/${id}`, {
      content,
    });
    return data;
  },
  async validate(id: string): Promise<ValidationReport | GeneratedArtifact> {
    const { data } = await http.post(`/automation/${id}/validate`, {});
    return data as ValidationReport | GeneratedArtifact;
  },
  async approve(
    id: string,
    decision: ApprovalDecision,
    comment?: string,
  ): Promise<{ id: string; approvalStatus: string; version: number }> {
    const { data } = await http.post(`/automation/${id}/approval`, { decision, comment });
    return data as { id: string; approvalStatus: string; version: number };
  },
  async executionPlan(id: string): Promise<ExecutionPlan> {
    const { data } = await http.get<ExecutionPlan>(`/automation/${id}/execution-plan`);
    return data;
  },
  /**
   * The UI Scanner locators this generated file was built from (§10).
   *
   * Read from the persisted traceability rows, so the panel reflects the
   * locator's current version and validation status rather than a snapshot
   * frozen at generation time.
   */
  async locatorReferences(id: string): Promise<StepLocatorReference[]> {
    const { data } = await http.get<StepLocatorReference[]>(
      `/automation/${id}/locator-references`,
    );
    return data;
  },
  /** Governed validation exception (FR-V3-ENT-002, §23.3). */
  async overrideValidation(
    id: string,
    reason: string,
  ): Promise<{ artifactId: string; validationStatus: string }> {
    const { data } = await http.post(`/automation/${id}/validation-override`, { reason });
    return data as { artifactId: string; validationStatus: string };
  },
};

// ---- Executions (FR-EXE-*) -------------------------------------------------

export const executionsApi = {
  async create(input: CreateExecutionInput): Promise<{ id: string; status: string }> {
    const { data } = await http.post('/executions', input);
    return data as { id: string; status: string };
  },
  async get(id: string): Promise<ExecutionRun> {
    const { data } = await http.get<ExecutionRun>(`/executions/${id}`);
    return data;
  },
  async events(id: string, fromSeq = 0): Promise<ExecutionEventRow[]> {
    const { data } = await http.get<ExecutionEventRow[]>(`/executions/${id}/events`, {
      params: { fromSeq },
    });
    return data;
  },
  /** Real-time execution log replay (console seed + reconnect gap). */
  async logs(id: string, fromSeq = 0): Promise<ExecutionLogRow[]> {
    const { data } = await http.get<ExecutionLogRow[]>(`/executions/${id}/logs`, {
      params: { fromSeq },
    });
    return data;
  },
  async cancel(id: string): Promise<{ id: string; cancelled: boolean; status: string }> {
    const { data } = await http.post(`/executions/${id}/cancel`, {});
    return data as { id: string; cancelled: boolean; status: string };
  },
  async report(id: string): Promise<Record<string, unknown>> {
    const { data } = await http.get<Record<string, unknown>>(`/executions/${id}/report`);
    return data;
  },
  /** Restart control (FR-V3-EXE-008): new run with the same configuration. */
  async restart(id: string): Promise<{ id: string; status: string }> {
    const { data } = await http.post(`/executions/${id}/restart`, {});
    return data as { id: string; status: string };
  },
  async listByProject(projectId: string): Promise<ExecutionRun[]> {
    const { data } = await http.get<ExecutionRun[]>(`/projects/${projectId}/executions`);
    return data;
  },
  async results(id: string): Promise<TestResult[]> {
    const { data } = await http.get<TestResult[]>(`/executions/${id}/results`);
    return data;
  },
  /** Async report generation (FR-V3-LOG-006) → {jobId}. */
  async generateReport(id: string): Promise<JobAccepted> {
    const { data } = await http.post<JobAccepted>(
      `/executions/${id}/report/generate`,
      {},
    );
    return data;
  },
  /** Report publication gate (FR-V3-ENT-002). */
  async approveReport(
    id: string,
    decision: ApprovalDecision,
    comment?: string,
  ): Promise<{ executionRunId: string; decision: string }> {
    const { data } = await http.post(`/executions/${id}/report/approval`, {
      decision,
      comment,
    });
    return data as { executionRunId: string; decision: string };
  },
  reportExportUrl(
    id: string,
    format: 'pdf' | 'html' | 'json' | 'junit' | 'csv',
  ): string {
    return `/executions/${id}/report/export?format=${format}`;
  },
};

// ---- UI Scanner (FR-UIS-*) -------------------------------------------------

export const uiScannerApi = {
  /**
   * Start a scan. `username`/`password` are single-use credentials for the
   * target application: the backend forwards them to the browser session and
   * never stores, logs or returns them (§16).
   */
  async start(
    projectId: string,
    input: StartUiScanInput,
  ): Promise<{ id: string; status: string; url: string }> {
    const { data } = await http.post(`/projects/${projectId}/ui-scans`, input);
    return data as { id: string; status: string; url: string };
  },
  async list(projectId: string): Promise<UiScan[]> {
    const { data } = await http.get<UiScan[]>(`/projects/${projectId}/ui-scans`);
    return data;
  },
  async get(projectId: string, scanId: string): Promise<UiScan> {
    const { data } = await http.get<UiScan>(
      `/projects/${projectId}/ui-scans/${scanId}`,
    );
    return data;
  },
  async cancel(
    projectId: string,
    scanId: string,
  ): Promise<{ id: string; cancelled: boolean; status: string }> {
    const { data } = await http.post(
      `/projects/${projectId}/ui-scans/${scanId}/cancel`,
      {},
    );
    return data as { id: string; cancelled: boolean; status: string };
  },
  async rescan(
    projectId: string,
    scanId: string,
    input: Partial<StartUiScanInput> = {},
  ): Promise<{ id: string; status: string; url: string }> {
    const { data } = await http.post(
      `/projects/${projectId}/ui-scans/${scanId}/rescan`,
      input,
    );
    return data as { id: string; status: string; url: string };
  },
  /** Persisted log replay for the console seed and reconnect gap. */
  async logs(
    projectId: string,
    scanId: string,
    fromSeq = 0,
  ): Promise<UiScanLogRow[]> {
    const { data } = await http.get<UiScanLogRow[]>(
      `/projects/${projectId}/ui-scans/${scanId}/logs`,
      { params: { fromSeq } },
    );
    return data;
  },
  async elements(
    projectId: string,
    scanId: string,
    filter: { status?: string; q?: string } = {},
  ): Promise<ScannedElement[]> {
    const { data } = await http.get<ScannedElement[]>(
      `/projects/${projectId}/ui-scans/${scanId}/elements`,
      { params: filter },
    );
    return data;
  },
  /** Artefact URLs are relative to the API base and require the bearer token. */
  screenshotUrl(projectId: string, scanId: string): string {
    return `/projects/${projectId}/ui-scans/${scanId}/artifacts/screenshot`;
  },
  accessibilityUrl(projectId: string, scanId: string): string {
    return `/projects/${projectId}/ui-scans/${scanId}/artifacts/accessibility`;
  },
  async accessibilitySnapshot(projectId: string, scanId: string): Promise<string> {
    const { data } = await http.get<string>(
      `/projects/${projectId}/ui-scans/${scanId}/artifacts/accessibility`,
      { responseType: 'text' },
    );
    return data;
  },
  /** Re-validate one element's locator against the live page. */
  async validateElement(
    projectId: string,
    scanId: string,
    elementId: string,
    input: {
      candidateId?: string;
      url?: string;
      loginUrl?: string;
      username?: string;
      password?: string;
    } = {},
  ): Promise<ScannedElement> {
    const { data } = await http.post<ScannedElement>(
      `/projects/${projectId}/ui-scans/${scanId}/elements/${elementId}/validate`,
      input,
    );
    return data;
  },
  /** Replace an element's locator with a hand-edited (structural) one. */
  async updateLocator(
    projectId: string,
    scanId: string,
    elementId: string,
    locatorData: LocatorData,
    elementName?: string,
  ): Promise<ScannedElement> {
    const { data } = await http.patch<ScannedElement>(
      `/projects/${projectId}/ui-scans/${scanId}/elements/${elementId}/locator`,
      { locatorData, elementName },
    );
    return data;
  },
  async approveElement(
    projectId: string,
    scanId: string,
    elementId: string,
    input: { approved?: boolean; candidateId?: string } = {},
  ): Promise<ScannedElement> {
    const { data } = await http.post<ScannedElement>(
      `/projects/${projectId}/ui-scans/${scanId}/elements/${elementId}/approve`,
      input,
    );
    return data;
  },
  async approveHighConfidence(
    projectId: string,
    scanId: string,
    input: { minConfidence?: number; uniqueOnly?: boolean } = {},
  ): Promise<{ approved: number; skipped: number; minConfidence: number }> {
    const { data } = await http.post(
      `/projects/${projectId}/ui-scans/${scanId}/approve-high-confidence`,
      input,
    );
    return data as { approved: number; skipped: number; minConfidence: number };
  },
  async saveLocators(
    projectId: string,
    scanId: string,
    input: { elementIds?: string[]; pageName?: string } = {},
  ): Promise<{ saved: number; superseded: number }> {
    const { data } = await http.post(
      `/projects/${projectId}/ui-scans/${scanId}/save-locators`,
      input,
    );
    return data as { saved: number; superseded: number };
  },
  async metrics(projectId: string): Promise<ProjectLocatorMetrics> {
    const { data } = await http.get<ProjectLocatorMetrics>(
      `/projects/${projectId}/ui-scans/metrics`,
    );
    return data;
  },
  async locators(
    projectId: string,
    filter: { pageUrlPattern?: string; approvedOnly?: string } = {},
  ): Promise<LocatorRecord[]> {
    const { data } = await http.get<LocatorRecord[]>(
      `/projects/${projectId}/locators`,
      { params: filter },
    );
    return data;
  },
  /** Authentication states available to the project (ids only, §16). */
  async storageStates(projectId: string): Promise<{ id: string; label: string }[]> {
    const { data } = await http.get<{ id: string; label: string }[]>(
      `/projects/${projectId}/ui-scan-storage-states`,
    );
    return data;
  },
};

// ---- Locator resolution (FR-UIS-025 §16) -----------------------------------

/**
 * Binding test steps to scanned locators.
 *
 * `resolveBatch` is the preferred call: one library read and one grouped
 * revalidation pass for a whole set of test cases, rather than a round trip per
 * step.
 */
export const locatorsApi = {
  async resolve(
    projectId: string,
    input: {
      testCaseId?: string;
      pageName?: string;
      steps?: { testStepId: string; description: string; action?: string }[];
      revalidate?: boolean;
      allowTargetedRescan?: boolean;
      allowLlmMatching?: boolean;
    },
  ): Promise<LocatorResolutionResult> {
    const { data } = await http.post<LocatorResolutionResult>(
      `/projects/${projectId}/locators/resolve`,
      input,
    );
    return data;
  },
  async resolveBatch(
    projectId: string,
    testCaseIds: string[],
    options: { revalidate?: boolean; allowTargetedRescan?: boolean } = {},
  ): Promise<{
    results: LocatorResolutionResult[];
    resolvedCount: number;
    unresolvedCount: number;
  }> {
    const { data } = await http.post(
      `/projects/${projectId}/locators/resolve-batch`,
      { testCaseIds, ...options },
    );
    return data as {
      results: LocatorResolutionResult[];
      resolvedCount: number;
      unresolvedCount: number;
    };
  },
  /** Re-validate stored locators against the live application (§5). */
  async revalidate(
    projectId: string,
    locatorIds: string[],
  ): Promise<{
    results: {
      locatorId: string;
      matchCount: number;
      unique: boolean;
      validationStatus: string;
      error?: string;
    }[];
  }> {
    const { data } = await http.post(
      `/projects/${projectId}/locators/revalidate`,
      { locatorIds },
    );
    return data as {
      results: {
        locatorId: string;
        matchCount: number;
        unique: boolean;
        validationStatus: string;
        error?: string;
      }[];
    };
  },
  async get(projectId: string, locatorId: string): Promise<LocatorRecord> {
    const { data } = await http.get<LocatorRecord>(
      `/projects/${projectId}/locators/${locatorId}`,
    );
    return data;
  },
  /** Where a locator is used and how it has behaved when executed (§15). */
  async usage(
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
  }> {
    const { data } = await http.get(
      `/projects/${projectId}/locators/${locatorId}/usage`,
    );
    return data as {
      locatorId: string;
      usageCount: number;
      lastUsedAt: string | null;
      executionSuccessCount: number;
      executionFailureCount: number;
      lastExecutedAt: string | null;
      lastFailureReason: string;
      locatorFailure: boolean;
      references: StepLocatorReference[];
    };
  },
};

// ---- Findings / defects (FR-RES-*, FR-BUG-*) -------------------------------

export const findingsApi = {
  async classify(resultId: string, context?: Record<string, unknown>): Promise<Finding> {
    const { data } = await http.post<Finding>(`/results/${resultId}/classify`, { context });
    return data;
  },
  async override(
    id: string,
    classification: FindingClassification,
    reason: string,
  ): Promise<Finding> {
    const { data } = await http.post<Finding>(`/findings/${id}/override`, {
      classification,
      reason,
    });
    return data;
  },
  async defectDraft(id: string): Promise<Finding> {
    const { data } = await http.post<Finding>(`/findings/${id}/defect-draft`, {});
    return data;
  },
};

// ---- Audit (FR-AUD-*) ------------------------------------------------------

export interface AuditFilter {
  actor?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const auditApi = {
  async list(filter: AuditFilter): Promise<AuditEvent[] | Paginated<AuditEvent>> {
    const { data } = await http.get('/audit', { params: filter });
    return data as AuditEvent[] | Paginated<AuditEvent>;
  },
};

// ---- Jobs (FR-BE-006) ------------------------------------------------------

export const jobsApi = {
  async get(id: string): Promise<Job> {
    const { data } = await http.get<Job>(`/jobs/${id}`);
    return data;
  },
  async list(projectId: string): Promise<Job[]> {
    const { data } = await http.get<Job[]>(`/projects/${projectId}/jobs`);
    return data;
  },
  /** Persisted live-log entries for replay after refresh (FR-V3-LOG-008). */
  async logs(id: string, fromSeq = 0): Promise<JobLogEntry[]> {
    const { data } = await http.get<JobLogEntry[]>(`/jobs/${id}/logs`, {
      params: { fromSeq },
    });
    return data;
  },
  /** Cancel an eligible long-running job (FR-V3-LOG-009). */
  async cancel(id: string): Promise<Job> {
    const { data } = await http.post<Job>(`/jobs/${id}/cancel`, {});
    return data;
  },
  /** Retry a finished job as a traceable new attempt (FR-V3-LOG-009). */
  async retry(id: string): Promise<{ jobId: string; status: string }> {
    const { data } = await http.post(`/jobs/${id}/retry`, {});
    return data as { jobId: string; status: string };
  },
};

// ---- Notifications (FR-V3-ENT-007) ------------------------------------------

export const notificationsApi = {
  async list(unreadOnly = false): Promise<AppNotification[]> {
    const { data } = await http.get<AppNotification[]>('/notifications', {
      params: unreadOnly ? { unread: 'true' } : {},
    });
    return data;
  },
  async unreadCount(): Promise<number> {
    const { data } = await http.get<{ count: number }>('/notifications/unread-count');
    return data.count;
  },
  async markRead(id: string): Promise<AppNotification> {
    const { data } = await http.post<AppNotification>(`/notifications/${id}/read`, {});
    return data;
  },
  async markAllRead(): Promise<{ updated: number }> {
    const { data } = await http.post<{ updated: number }>('/notifications/read-all', {});
    return data;
  },
};

// ---- CI/CD (FR-V3-CI-*) ------------------------------------------------------

export const ciApi = {
  async dispatch(projectId: string, workflow?: string, ref?: string) {
    const { data } = await http.post('/ci/workflows/dispatch', {
      projectId,
      workflow,
      ref,
    });
    return data as { ciRunId: string; status: string; mode: string; ciUrl: string };
  },
  async listRuns(projectId: string): Promise<ExecutionRun[]> {
    const { data } = await http.get<ExecutionRun[]>(`/ci/projects/${projectId}/runs`);
    return data;
  },
  async getRun(id: string): Promise<ExecutionRun> {
    const { data } = await http.get<ExecutionRun>(`/ci/runs/${id}`);
    return data;
  },
};

// ---- Health (§17) ----------------------------------------------------------

export const healthApi = {
  async get(): Promise<HealthStatus> {
    const { data } = await http.get<HealthStatus>('/health');
    return data;
  },
};

// ---- Approvals helpers -----------------------------------------------------
// There is no aggregate `/approvals` endpoint in the contract; the inbox page
// composes pending items from the per-resource list endpoints. Approval history
// for a resource is read from that resource's detail payload where available.

export type { ApprovalResourceType, Approval, TestResult };
