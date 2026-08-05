import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { LiveJobConsole } from '../components/LiveJobConsole';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { useProjectId, useProject } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { UiScannerPanel } from '../features/ui-scanner/UiScannerPanel';
import {
  analysisApi,
  documentsApi,
  jobsApi,
  requirementsApi,
} from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { Analysis, Job, RequirementAnalysisOutput } from '../services/api/types';
import { toDisplayString } from '../lib/sanitize';
import { formatRelative } from '../lib/format';
import L from '../styles/layout.module.css';

/** Sections of the Analysis page (FR-RA-*, FR-UIS-002). */
type AnalysisTab = 'documents' | 'application' | 'ui-scanner' | 'logs';

const TABS: TabItem[] = [
  { key: 'documents', label: 'Document Analysis' },
  { key: 'application', label: 'Application Analysis' },
  { key: 'ui-scanner', label: 'UI Scanner' },
  { key: 'logs', label: 'Analysis Logs' },
];

function asList(...values: unknown[]): string[] {
  for (const v of values) {
    if (Array.isArray(v)) return v.map(toDisplayString).filter(Boolean);
  }
  return [];
}

function riskOf(a: Analysis): number {
  const o = a.output as RequirementAnalysisOutput;
  return a.riskScore ?? o.riskScore ?? o.risk_score ?? 0;
}

function Bullets({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className={L.muted} style={{ fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }): JSX.Element {
  const o = analysis.output as RequirementAnalysisOutput;
  const risk = riskOf(analysis);
  const riskTone = risk >= 7 ? 'danger' : risk >= 4 ? 'warn' : 'ok';
  return (
    <Card
      title={o.summary ? toDisplayString(o.summary).slice(0, 80) : `Analysis ${analysis.id.slice(0, 8)}`}
      subtitle={`${analysis.model || 'model'} · ${formatRelative(analysis.createdAt)}`}
      actions={<StatusBadge status={riskTone} label={`risk ${risk}/10`} />}
    >
      <Bullets title="Actors" items={asList(o.actors)} />
      <Bullets title="Assumptions" items={asList(o.assumptions)} />
      <Bullets title="Gaps" items={asList(o.gaps)} />
      <Bullets
        title="Clarification questions"
        items={asList(o.clarificationQuestions, o.clarification_questions)}
      />
      {o.riskRationale != null && (
        <div style={{ marginTop: 10 }}>
          <div className={L.muted} style={{ fontWeight: 600 }}>
            Risk rationale
          </div>
          <div>{toDisplayString(o.riskRationale)}</div>
        </div>
      )}
    </Card>
  );
}

/** Recent analysis jobs with their live consoles (FR-V3-LOG-008). */
function AnalysisLogsTab({ projectId }: { projectId: string }): JSX.Element {
  const jobsQuery = useQuery({
    queryKey: qk.jobs(projectId),
    queryFn: () => jobsApi.list(projectId),
    enabled: !!projectId,
  });
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  return (
    <QueryState query={jobsQuery} loadingLabel="Loading analysis jobs…">
      {(jobs: Job[]) => {
        const analysisJobs = jobs.filter((j) => j.type === 'analysis');
        if (analysisJobs.length === 0) {
          return (
            <EmptyState title="No analysis runs yet">
              Run an analysis from the Document Analysis tab to see its live log
              here.
            </EmptyState>
          );
        }
        return (
          <div className={L.stack}>
            {analysisJobs.map((job) => (
              <Card
                key={job.id}
                title={`Analysis job ${job.id.slice(0, 8)}`}
                subtitle={`${job.currentStage || job.status} · ${formatRelative(job.createdAt)}`}
                actions={
                  <div className={L.row}>
                    <StatusBadge status={job.status} />
                    <Button
                      small
                      variant="ghost"
                      onClick={() =>
                        setOpenJobId((cur) => (cur === job.id ? null : job.id))
                      }
                    >
                      {openJobId === job.id ? 'Hide log' : 'View log'}
                    </Button>
                  </div>
                }
              >
                {openJobId === job.id && (
                  <LiveJobConsole
                    projectId={projectId}
                    jobId={job.id}
                    title="Requirement analysis"
                  />
                )}
              </Card>
            ))}
          </div>
        );
      }}
    </QueryState>
  );
}

export function AnalysisPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<AnalysisTab>('documents');
  useProjectEvents(projectId);

  const projectQuery = useProject(projectId);

  const requirementsQuery = useQuery({
    queryKey: qk.requirements(projectId),
    queryFn: () => requirementsApi.list(projectId),
    enabled: !!projectId,
  });
  const analysesQuery = useQuery({
    queryKey: qk.analyses(projectId),
    queryFn: () => analysisApi.list(projectId),
    enabled: !!projectId,
  });
  const documentsQuery = useQuery({
    queryKey: qk.documents(projectId),
    queryFn: () => documentsApi.list(projectId),
    enabled: !!projectId,
  });

  const runAnalysis = useMutation({
    mutationFn: () => {
      // Analyse manual requirements AND uploaded documents (FR-IN-008): the
      // backend derives requirements from document segments before analysing.
      const requirementIds = (requirementsQuery.data ?? []).map((r) => r.id);
      const documentIds = (documentsQuery.data ?? []).map((d) => d.id);
      return analysisApi.createJob(projectId, { requirementIds, documentIds });
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: qk.jobs(projectId) });
    },
  });

  const reqCount = requirementsQuery.data?.length ?? 0;
  const docCount = documentsQuery.data?.length ?? 0;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Analysis"
        subtitle="Requirement analysis, application analysis and UI element discovery (FR-RA-*, FR-UIS-*)"
        actions={
          tab === 'documents' && (
            <Button
              variant="primary"
              loading={runAnalysis.isPending}
              disabled={(reqCount === 0 && docCount === 0) || runAnalysis.isPending}
              onClick={() => runAnalysis.mutate()}
            >
              Analyse {reqCount} requirement{reqCount === 1 ? '' : 's'}
              {docCount > 0 ? ` + ${docCount} document${docCount === 1 ? '' : 's'}` : ''}
            </Button>
          )
        }
      />

      <Tabs items={TABS} active={tab} onChange={(key) => setTab(key as AnalysisTab)} />

      {tab === 'documents' && (
        <>
          {runAnalysis.isError && <ErrorBanner error={runAnalysis.error} />}
          {activeJobId && (
            <LiveJobConsole
              projectId={projectId}
              jobId={activeJobId}
              onRetried={setActiveJobId}
              title="Analysing documents and requirements"
              onFinished={() => {
                void qc.invalidateQueries({ queryKey: qk.analyses(projectId) });
              }}
            />
          )}
          {reqCount === 0 &&
            docCount === 0 &&
            requirementsQuery.isSuccess &&
            documentsQuery.isSuccess && (
              <Banner kind="warn">
                Add requirements or upload documents first to run analysis.
              </Banner>
            )}

          <QueryState query={analysesQuery} loadingLabel="Loading analyses…">
            {(analyses) =>
              analyses.length === 0 ? (
                <EmptyState title="No analysis yet">
                  Run analysis to extract actors, assumptions, gaps and a risk score.
                </EmptyState>
              ) : (
                <div className={L.grid2}>
                  {analyses.map((a) => (
                    <AnalysisCard key={a.id} analysis={a} />
                  ))}
                </div>
              )
            }
          </QueryState>
        </>
      )}

      {tab === 'application' && (
        <Card
          title="Application under test"
          subtitle="The configuration every browser-driven agent uses for this project"
        >
          <QueryState query={projectQuery} loadingLabel="Loading project…">
            {(project) => (
              <>
                <dl className={L.kv}>
                  <dt>Base URL</dt>
                  <dd>{project.baseUrl || '(not configured)'}</dd>
                  <dt>Allowed domains</dt>
                  <dd className={L.mono}>{project.allowedDomains}</dd>
                  <dt>Environment</dt>
                  <dd>{project.environment}</dd>
                  <dt>Runner</dt>
                  <dd>{project.runner}</dd>
                  <dt>Model</dt>
                  <dd>{project.llmModel || '(engine default)'}</dd>
                  <dt>Requirements</dt>
                  <dd>{project.workflowSummary.requirements}</dd>
                  <dt>Analyses</dt>
                  <dd>{project.workflowSummary.analyses}</dd>
                  <dt>Test cases</dt>
                  <dd>{project.workflowSummary.testCases}</dd>
                </dl>
                {!project.baseUrl && (
                  <Banner kind="warn">
                    Set a base URL in project settings so the UI Scanner and the
                    execution runner know which application to open.
                  </Banner>
                )}
              </>
            )}
          </QueryState>
        </Card>
      )}

      {tab === 'ui-scanner' && (
        <UiScannerPanel projectId={projectId} project={projectQuery.data} />
      )}

      {tab === 'logs' && <AnalysisLogsTab projectId={projectId} />}
    </div>
  );
}
