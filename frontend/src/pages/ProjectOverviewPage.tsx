import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Banner } from '../components/ui/Banner';
import { useProject, useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { jobsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { WorkflowSummary } from '../services/api/types';
import { formatRelative } from '../lib/format';
import L from '../styles/layout.module.css';

interface Stage {
  label: string;
  to: string;
  count: number;
  approved?: number;
  ready: boolean;
}

function buildStages(id: string, w: WorkflowSummary): Stage[] {
  return [
    { label: 'Documents', to: `/projects/${id}/upload`, count: w.documents, ready: w.documents > 0 },
    { label: 'Requirements', to: `/projects/${id}/upload`, count: w.requirements, ready: w.requirements > 0 },
    { label: 'Analysis', to: `/projects/${id}/analysis`, count: w.analyses, ready: w.analyses > 0 },
    {
      label: 'Test Plan',
      to: `/projects/${id}/test-plan`,
      count: w.testPlans,
      approved: w.approvedPlans,
      ready: w.approvedPlans > 0,
    },
    {
      label: 'Test Cases',
      to: `/projects/${id}/test-cases`,
      count: w.testCases,
      approved: w.approvedCases,
      ready: w.approvedCases > 0,
    },
    { label: 'Automation', to: `/projects/${id}/automation`, count: w.artifacts, ready: w.artifacts > 0 },
    { label: 'Executions', to: `/projects/${id}/reports`, count: w.executions, ready: w.executions > 0 },
  ];
}

function StatTile({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className={L.stat}>
      <div className={L.statValue}>{value}</div>
      <div className={L.statLabel}>{label}</div>
    </div>
  );
}

export function ProjectOverviewPage(): JSX.Element {
  const projectId = useProjectId();
  const projectQuery = useProject(projectId);
  const { last } = useProjectEvents(projectId);
  const jobsQuery = useQuery({
    queryKey: qk.jobs(projectId),
    queryFn: () => jobsApi.list(projectId),
    enabled: !!projectId,
  });

  return (
    <div className={L.stack}>
      <QueryState query={projectQuery}>
        {(project) => {
          const w = project.workflowSummary;
          const stages = buildStages(projectId, w);
          return (
            <>
              <PageHeader
                title={project.name}
                subtitle={project.description || project.baseUrl || 'Workflow overview'}
                actions={
                  <>
                    <StatusBadge status={project.status} />
                    <Link to={`/projects/${projectId}/upload`}>
                      <Button variant="primary">Upload sources</Button>
                    </Link>
                  </>
                }
              />

              {last && (
                <Banner kind="info">
                  Live update: <strong>{last.type}</strong> · {formatRelative(last.ts)}
                </Banner>
              )}

              <div className={L.statTiles}>
                <StatTile label="Documents" value={w.documents} />
                <StatTile label="Requirements" value={w.requirements} />
                <StatTile label="Analyses" value={w.analyses} />
                <StatTile label="Test cases" value={w.testCases} />
                <StatTile label="Automation files" value={w.artifacts} />
                <StatTile label="Executions" value={w.executions} />
                <StatTile label="Pending approvals" value={w.pendingApprovals} />
              </div>

              <Card title="Workflow stages" subtitle="Stage progress and approval gates (FR-PROJ-006)">
                <ol className={stagesListClass}>
                  {stages.map((st) => (
                    <li key={st.label} className={L.rowBetween} style={stageRowStyle}>
                      <Link to={st.to} style={{ fontWeight: 600 }}>
                        {st.label}
                      </Link>
                      <span className={L.row}>
                        <span className={L.muted}>
                          {st.count} item{st.count === 1 ? '' : 's'}
                          {st.approved !== undefined ? ` · ${st.approved} approved` : ''}
                        </span>
                        <StatusBadge
                          status={st.ready ? 'completed' : st.count > 0 ? 'pending' : 'idle'}
                          label={st.ready ? 'ready' : st.count > 0 ? 'in progress' : 'not started'}
                        />
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card title="Recent generation jobs">
                <QueryState query={jobsQuery} loadingLabel="Loading jobs…">
                  {(jobs) =>
                    jobs.length === 0 ? (
                      <p className={L.muted}>No generation jobs yet.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {jobs.slice(0, 8).map((j) => (
                          <li key={j.id} className={L.rowBetween} style={stageRowStyle}>
                            <span>
                              <strong>{j.type}</strong>{' '}
                              <span className={L.muted}>{formatRelative(j.createdAt)}</span>
                            </span>
                            <span className={L.row}>
                              {j.progress > 0 && j.status === 'running' && (
                                <span className={L.muted}>{j.progress}%</span>
                              )}
                              <StatusBadge status={j.status} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </QueryState>
              </Card>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

const stagesListClass = '';
const stageRowStyle = {
  padding: '9px 0',
  borderBottom: '1px solid var(--border)',
  listStyle: 'none' as const,
};
