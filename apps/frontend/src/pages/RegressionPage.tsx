/**
 * Regression comparison page: diff a candidate execution run against the
 * project's baseline run and browse the comparison history. Node ids are
 * pytest node ids — there is no per-test page, so cross-links go to the
 * candidate run's execution report.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LinkButton } from '../components/ui/LinkButton';
import { Select } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { useProjectId } from '../features/projects/hooks';
import { executionsApi, regressionApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { ExecutionRun, RegressionComparison } from '../services/api/types';
import { formatRelative } from '../lib/format';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

function runLabel(run: ExecutionRun): string {
  return `${run.id.slice(0, 8)} · ${run.status} · ${formatRelative(run.startedAt ?? run.createdAt)}`;
}

/** One bucket of pytest node ids as a table section (only when non-empty). */
function BucketTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ nodeId: string; status?: string }>;
}): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Card title={`${title} (${rows.length})`} noPad>
      <div className={ui.tableWrap}>
        <table className={ui.table} style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Test (pytest node id)</th>
              {rows.some((r) => r.status) && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nodeId}>
                <td className={L.mono}>{r.nodeId}</td>
                {rows.some((x) => x.status) && (
                  <td>{r.status ? <StatusBadge status={r.status} /> : null}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ComparisonResult({ comparison }: { comparison: RegressionComparison }): JSX.Element {
  const r = comparison.result;
  const summary = r.summary;
  const buckets =
    r.regressions.length +
    r.fixes.length +
    r.still_failing.length +
    r.new_tests.length +
    r.missing_tests.length;

  return (
    <div className={L.stack}>
      <Card
        title="Comparison result"
        subtitle={`${comparison.baselineRunId.slice(0, 8)} → ${comparison.candidateRunId.slice(0, 8)} · ${formatRelative(comparison.createdAt)}`}
        actions={
          <LinkButton small to={`/executions/${comparison.candidateRunId}/report`}>
            Candidate report
          </LinkButton>
        }
      >
        <div className={L.stack}>
          {summary.has_regressions ? (
            <Banner kind="error" title={`${summary.regressed} regression${summary.regressed === 1 ? '' : 's'} detected`}>
              Tests that passed in the baseline now fail in the candidate run.
            </Banner>
          ) : (
            <Banner kind="success" title="No regressions">
              Every test that passed in the baseline still passes.
            </Banner>
          )}

          <div className={L.statTiles}>
            <div className={L.stat}>
              <div className={L.statValue}>{summary.baseline_total}</div>
              <div className={L.statLabel}>Baseline total</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue}>{summary.current_total}</div>
              <div className={L.statLabel}>Current total</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--danger)' }}>
                {summary.regressed}
              </div>
              <div className={L.statLabel}>Regressed</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--ok)' }}>
                {summary.fixed}
              </div>
              <div className={L.statLabel}>Fixed</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--warn)' }}>
                {summary.still_failing}
              </div>
              <div className={L.statLabel}>Still failing</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue}>{summary.new}</div>
              <div className={L.statLabel}>New</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--neutral)' }}>
                {summary.missing}
              </div>
              <div className={L.statLabel}>Missing</div>
            </div>
            <div className={L.stat}>
              <div className={L.statValue} style={{ color: 'var(--ok)' }}>
                {r.stable_passes}
              </div>
              <div className={L.statLabel}>Stable passes</div>
            </div>
          </div>
        </div>
      </Card>

      {buckets === 0 ? (
        <EmptyState title="Nothing changed between the runs">
          No regressions, fixes, new or missing tests — the candidate run matches
          the baseline.
        </EmptyState>
      ) : (
        <>
          <BucketTable
            title="Regressions"
            rows={r.regressions.map((nodeId) => ({ nodeId }))}
          />
          <BucketTable title="Fixes" rows={r.fixes.map((nodeId) => ({ nodeId }))} />
          <BucketTable
            title="Still failing"
            rows={r.still_failing.map((nodeId) => ({ nodeId }))}
          />
          <BucketTable
            title="New tests"
            rows={r.new_tests.map((t) => ({ nodeId: t.node_id, status: t.status }))}
          />
          <BucketTable
            title="Missing tests"
            rows={r.missing_tests.map((nodeId) => ({ nodeId }))}
          />
        </>
      )}
    </div>
  );
}

export function RegressionPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const [baselineRunId, setBaselineRunId] = useState('');
  const [candidateRunId, setCandidateRunId] = useState('');
  const [selected, setSelected] = useState<RegressionComparison | null>(null);

  const runsQuery = useQuery({
    queryKey: qk.projectExecutions(projectId),
    queryFn: () => executionsApi.listByProject(projectId),
    enabled: !!projectId,
  });
  const historyQuery = useQuery({
    queryKey: qk.regressionComparisons(projectId),
    queryFn: () => regressionApi.list(projectId),
    enabled: !!projectId,
  });

  // Default the baseline picker to the project's marked baseline run.
  useEffect(() => {
    if (!baselineRunId && runsQuery.data) {
      const baseline = runsQuery.data.find((r) => r.isBaseline);
      if (baseline) setBaselineRunId(baseline.id);
    }
  }, [runsQuery.data, baselineRunId]);

  const compare = useMutation({
    mutationFn: () => regressionApi.compare(projectId, baselineRunId, candidateRunId),
    onSuccess: (comparison) => {
      setSelected(comparison);
      void qc.invalidateQueries({ queryKey: qk.regressionComparisons(projectId) });
    },
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Regression"
        subtitle="Compare a candidate execution run against the project baseline"
      />

      <Card
        title="Compare runs"
        subtitle="Pick a baseline and a candidate run, then compare their results"
      >
        <QueryState query={runsQuery} loadingLabel="Loading execution runs…">
          {(runs) =>
            runs.length === 0 ? (
              <EmptyState title="No execution runs yet">
                Run automation to produce execution runs, then compare them here.
              </EmptyState>
            ) : (
              <div className={L.stack} style={{ gap: 8 }}>
                <div className={L.row} style={{ gap: 8, alignItems: 'end' }}>
                  <Select
                    label="Baseline run"
                    value={baselineRunId}
                    onChange={(e) => setBaselineRunId(e.target.value)}
                    style={{ minWidth: 240 }}
                  >
                    <option value="">Select run…</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {runLabel(r)}
                        {r.isBaseline ? ' · baseline' : ''}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Candidate run"
                    value={candidateRunId}
                    onChange={(e) => setCandidateRunId(e.target.value)}
                    style={{ minWidth: 240 }}
                  >
                    <option value="">Select run…</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {runLabel(r)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    loading={compare.isPending}
                    disabled={
                      !baselineRunId ||
                      !candidateRunId ||
                      baselineRunId === candidateRunId
                    }
                    title={
                      baselineRunId && baselineRunId === candidateRunId
                        ? 'Pick two different runs'
                        : undefined
                    }
                    onClick={() => compare.mutate()}
                  >
                    Compare
                  </Button>
                </div>
                {compare.isError && <ErrorBanner error={compare.error} />}
              </div>
            )
          }
        </QueryState>
      </Card>

      {selected && <ComparisonResult comparison={selected} />}

      <Card title="History" subtitle="Previous comparisons, newest first">
        <QueryState query={historyQuery} loadingLabel="Loading comparisons…">
          {(comparisons) =>
            comparisons.length === 0 ? (
              <EmptyState title="No comparisons yet">
                Run a comparison above to start the regression history.
              </EmptyState>
            ) : (
              <div className={ui.tableWrap}>
                <table className={ui.table} style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Baseline → Candidate</th>
                      <th>Result</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((c) => (
                      <tr key={c.id}>
                        <td className={L.muted}>{formatRelative(c.createdAt)}</td>
                        <td className={L.mono}>
                          {c.baselineRunId.slice(0, 8)} → {c.candidateRunId.slice(0, 8)}
                        </td>
                        <td>
                          {c.hasRegressions ? (
                            <StatusBadge status="failed" label="regressions" />
                          ) : (
                            <StatusBadge status="passed" label="clean" />
                          )}
                        </td>
                        <td>
                          <div className={L.row}>
                            <Button small variant="ghost" onClick={() => setSelected(c)}>
                              View
                            </Button>
                            <LinkButton
                              small
                              variant="ghost"
                              to={`/executions/${c.candidateRunId}/report`}
                            >
                              Report
                            </LinkButton>
                          </div>
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
    </div>
  );
}
