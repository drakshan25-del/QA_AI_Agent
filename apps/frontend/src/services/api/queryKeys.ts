import type { TestCaseFilter, AuditFilter } from './endpoints';

/** Centralised react-query keys so invalidation stays consistent. */
export const qk = {
  health: ['health'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectMetrics: (id: string) => ['projects', id, 'metrics'] as const,
  documents: (projectId: string) => ['projects', projectId, 'documents'] as const,
  documentPreview: (id: string) => ['documents', id, 'preview'] as const,
  requirements: (projectId: string) => ['projects', projectId, 'requirements'] as const,
  analyses: (projectId: string) => ['projects', projectId, 'analyses'] as const,
  testPlans: (projectId: string) => ['projects', projectId, 'test-plans'] as const,
  testPlan: (id: string) => ['test-plans', id] as const,
  testCases: (projectId: string, filter: TestCaseFilter) =>
    ['projects', projectId, 'test-cases', filter] as const,
  testCase: (id: string) => ['test-cases', id] as const,
  coverage: (projectId: string) => ['projects', projectId, 'coverage'] as const,
  automation: (projectId: string) => ['projects', projectId, 'automation'] as const,
  automationItem: (id: string) => ['automation', id] as const,
  executionPlan: (id: string) => ['automation', id, 'execution-plan'] as const,
  execution: (id: string) => ['executions', id] as const,
  executionEvents: (id: string) => ['executions', id, 'events'] as const,
  executionReport: (id: string) => ['executions', id, 'report'] as const,
  jobs: (projectId: string) => ['projects', projectId, 'jobs'] as const,
  job: (id: string) => ['jobs', id] as const,
  audit: (filter: AuditFilter) => ['audit', filter] as const,
};
