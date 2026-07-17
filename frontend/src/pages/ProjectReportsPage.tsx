import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { useProjectId } from '../features/projects/hooks';
import { ciApi, projectsApi } from '../services/api/endpoints';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { qk } from '../services/api/queryKeys';
import type { ExecutionRun } from '../services/api/types';
import { formatRelative } from '../lib/format';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

interface Metrics {
  executions?: number;
  testCases?: number;
  results?: { total?: number; passed?: number; failed?: number; passRate?: number };
}

function MetricTiles({ projectId }: { projectId: string }): JSX.Element {
  const q = useQuery({
    queryKey: qk.projectMetrics(projectId),
    queryFn: () => projectsApi.metrics(projectId) as Promise<Metrics>,
    enabled: !!projectId,
  });
  return (
    <QueryState query={q} loadingLabel="Loading metrics…">
      {(m) => {
        const r = m.results ?? {};
        return (
          <div className={L.statTiles}>
            <div className={L.stat}>
              <div className={L.statValue}>{m.executions ?? 0}</div>
              <div className={L.statLabel}>Executions</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--ok)' }}>
                {r.passed ?? 0}
              </div>
              <div className={L.statLabel}>Passed results</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--danger)' }}>
                {r.failed ?? 0}
              </div>
              <div className={L.statLabel}>Failed results</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue}>
                {r.passRate != null ? `${Math.round(r.passRate * 100)}%` : '—'}
              </div>
              <div className={L.statLabel}>Pass rate</div>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

/** CI/CD status panel (FR-V3-CI-001/002): dispatch + run history with §23.7 states. */
function CiPanel({ projectId }: { projectId: string }): JSX.Element {
  const qc = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ['ci', projectId, 'runs'],
    queryFn: () => ciApi.listRuns(projectId),
    enabled: !!projectId,
  });
  const dispatch = useMutation({
    mutationFn: () => ciApi.dispatch(projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ci', projectId] }),
  });

  return (
    <Card
      title="CI/CD (GitHub Actions)"
      subtitle="Trigger approved workflows and track their state (FR-V3-CI-*)"
      actions={
        <Button
          small
          variant="primary"
          loading={dispatch.isPending}
          onClick={() => dispatch.mutate()}
        >
          Dispatch workflow
        </Button>
      }
    >
      {dispatch.isError && <ErrorBanner error={dispatch.error} />}
      {dispatch.isSuccess && (
        <Banner kind={dispatch.data.mode === 'dispatched' ? 'success' : 'warn'}>
          CI run {dispatch.data.ciRunId.slice(0, 8)} created ({dispatch.data.mode}
          {dispatch.data.mode !== 'dispatched'
            ? ' — configure GITHUB_TOKEN and a repository for a real dispatch'
            : ''}
          ).
          {dispatch.data.ciUrl && (
            <>
              {' '}
              <a href={dispatch.data.ciUrl} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </>
          )}
        </Banner>
      )}
      <QueryState query={runsQuery} loadingLabel="Loading CI runs…">
        {(runs) =>
          runs.length === 0 ? (
            <p className={L.muted}>No CI runs yet.</p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>State</th>
                    <th>Started</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className={L.mono}>{r.id.slice(0, 8)}</td>
                      <td>
                        <StatusBadge
                          status={String((r as unknown as { ciStatus?: string }).ciStatus ?? r.status)}
                        />
                      </td>
                      <td className={L.muted}>{formatRelative(r.startedAt ?? r.createdAt)}</td>
                      <td>
                        {r.ciUrl ? (
                          <a href={r.ciUrl} target="_blank" rel="noreferrer">
                            GitHub
                          </a>
                        ) : (
                          <span className={L.muted}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

export function ProjectReportsPage(): JSX.Element {
  const projectId = useProjectId();
  const exportQuery = useQuery({
    queryKey: [...qk.project(projectId), 'export'],
    queryFn: () => projectsApi.exportProject(projectId),
    enabled: !!projectId,
  });

  return (
    <div className={L.stack}>
      <PageHeader title="Reports" subtitle="Executions, CI/CD and aggregate metrics (FR-REP-*, §15.2)" />
      <MetricTiles projectId={projectId} />
      <CiPanel projectId={projectId} />

      <Card title="Executions">
        <QueryState query={exportQuery} loadingLabel="Loading executions…">
          {(data) => {
            const executions = ((data as { executions?: ExecutionRun[] }).executions ?? [])
              .slice()
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            if (executions.length === 0) {
              return (
                <EmptyState title="No executions yet">
                  Run approved automation to produce execution reports.
                </EmptyState>
              );
            }
            return (
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Environment</th>
                      <th>Results</th>
                      <th>Started</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((e) => (
                      <tr key={e.id}>
                        <td className={L.mono}>{e.id.slice(0, 8)}</td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                        <td>
                          {e.browser} · {e.environment}
                          {e.headed ? ' · headed' : ''}
                        </td>
                        <td className={L.muted}>
                          {(() => {
                            const m = (e.metrics ?? {}) as Record<string, number>;
                            const p = m.passed ?? 0;
                            const f = m.failed ?? 0;
                            return p + f > 0
                              ? `${p}/${p + f} passed (${Math.round((p / (p + f)) * 100)}%)`
                              : '—';
                          })()}
                        </td>
                        <td className={L.muted}>{formatRelative(e.startedAt ?? e.createdAt)}</td>
                        <td>
                          <div className={L.row}>
                            <Link to={`/executions/${e.id}`}>
                              <Button small variant="ghost">
                                Timeline
                              </Button>
                            </Link>
                            <Link to={`/executions/${e.id}/report`}>
                              <Button small>Report</Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </QueryState>
      </Card>
    </div>
  );
}
