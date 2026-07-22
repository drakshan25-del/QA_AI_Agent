import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { LiveJobConsole } from '../components/LiveJobConsole';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { SectionEditor } from '../features/test-plans/SectionEditor';
import { ApprovalControls } from '../features/approvals/ApprovalControls';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { testPlansApi } from '../services/api/endpoints';
import { downloadFile } from '../services/api/download';
import { qk } from '../services/api/queryKeys';
import type { ApprovalDecision, TestPlanRevision } from '../services/api/types';
import { toDisplayString } from '../lib/sanitize';
import { formatRelative } from '../lib/format';
import L from '../styles/layout.module.css';

/** Revision history + side-by-side compare + restore (FR-V3-TP-001/002/003). */
function RevisionsPanel({
  planId,
  projectId,
}: {
  planId: string;
  projectId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const [compare, setCompare] = useState<{ from: number; to: number } | null>(
    null,
  );

  const revisionsQuery = useQuery({
    queryKey: ['test-plans', planId, 'revisions'],
    queryFn: () => testPlansApi.revisions(planId),
  });
  const comparisonQuery = useQuery({
    queryKey: ['test-plans', planId, 'compare', compare?.from, compare?.to],
    queryFn: () => testPlansApi.compareRevisions(planId, compare!.from, compare!.to),
    enabled: !!compare,
  });
  const restore = useMutation({
    mutationFn: (version: number) => testPlansApi.restoreRevision(planId, version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.testPlans(projectId) });
      void qc.invalidateQueries({ queryKey: ['test-plans', planId, 'revisions'] });
    },
  });

  const revisions = revisionsQuery.data ?? [];
  const latestVersion = revisions[0]?.version ?? 1;

  return (
    <Card
      title="Revision history (FR-V3-TP-001)"
      subtitle={`${revisions.length} revision(s), latest v${latestVersion}`}
    >
      {restore.isError && <ErrorBanner error={restore.error} />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {revisions.map((rev: TestPlanRevision) => (
          <li
            key={rev.id}
            style={{ padding: '8px 4px', borderBottom: '1px solid var(--border)' }}
          >
            <div className={L.rowBetween}>
              <span>
                <strong>v{rev.version}</strong>{' '}
                <span className={L.muted}>
                  {rev.sourceAction} · {rev.author} · {formatRelative(rev.createdAt)}
                </span>
              </span>
              <StatusBadge status={rev.approvalStatus} />
            </div>
            {rev.changeSummary && (
              <div className={L.muted} style={{ fontSize: 12, marginTop: 2 }}>
                {rev.changeSummary}
              </div>
            )}
            <div className={L.row} style={{ marginTop: 6, gap: 6 }}>
              {rev.version !== latestVersion && (
                <>
                  <Button
                    small
                    onClick={() => setCompare({ from: rev.version, to: latestVersion })}
                  >
                    Compare with v{latestVersion}
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    loading={restore.isPending}
                    onClick={() => restore.mutate(rev.version)}
                  >
                    Restore
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
        {revisions.length === 0 && (
          <li className={L.muted}>No revisions recorded yet.</li>
        )}
      </ul>

      {compare && (
        <div style={{ marginTop: 12 }}>
          <div className={L.rowBetween}>
            <strong>
              Comparing v{compare.from} → v{compare.to}
            </strong>
            <Button small variant="ghost" onClick={() => setCompare(null)}>
              Close
            </Button>
          </div>
          {comparisonQuery.isLoading && <p className={L.muted}>Loading comparison…</p>}
          {comparisonQuery.data && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>Section</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>v{compare.from}</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>v{compare.to}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonQuery.data.sections
                    .filter((s) => s.change !== 'unchanged')
                    .map((s) => (
                      <tr key={s.section} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 4, verticalAlign: 'top' }}>
                          <strong>{s.section.replace(/_/g, ' ')}</strong>
                          <div className={L.muted}>{s.change}</div>
                        </td>
                        <td style={{ padding: 4, verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                          {toDisplayString(s.from ?? '—')}
                        </td>
                        <td style={{ padding: 4, verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                          {toDisplayString(s.to ?? '—')}
                        </td>
                      </tr>
                    ))}
                  {comparisonQuery.data.sections.every((s) => s.change === 'unchanged') && (
                    <tr>
                      <td colSpan={3} className={L.muted} style={{ padding: 4 }}>
                        The revisions are identical.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function TestPlanPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: qk.testPlans(projectId),
    queryFn: () => testPlansApi.list(projectId),
    enabled: !!projectId,
  });

  // Default-select the newest plan.
  useEffect(() => {
    if (plansQuery.data && plansQuery.data.length > 0 && !selectedId) {
      const newest = [...plansQuery.data].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      )[0];
      if (newest) setSelectedId(newest.id);
    }
  }, [plansQuery.data, selectedId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.testPlans(projectId) });
    void qc.invalidateQueries({ queryKey: qk.project(projectId) });
    if (selectedId) {
      void qc.invalidateQueries({
        queryKey: ['test-plans', selectedId, 'revisions'],
      });
    }
  };

  const generate = useMutation({
    mutationFn: () => testPlansApi.generate(projectId),
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: qk.jobs(projectId) });
    },
  });
  const saveSections = useMutation({
    mutationFn: (sections: Record<string, unknown>) =>
      testPlansApi.update(selectedId!, sections),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: (input: { decision: ApprovalDecision; comment: string }) =>
      testPlansApi.approve(selectedId!, input.decision, input.comment),
    onSuccess: invalidate,
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Test plan"
        subtitle="Structured plan with approval gate and revisions (FR-TP-*, FR-V3-TP-*)"
        actions={
          <Button
            variant="primary"
            loading={generate.isPending}
            onClick={() => generate.mutate()}
          >
            Generate test plan
          </Button>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}
      {activeJobId && (
        <LiveJobConsole
          projectId={projectId}
          jobId={activeJobId}
          onRetried={setActiveJobId}
          title="Generating test plan"
          onFinished={invalidate}
        />
      )}

      <QueryState query={plansQuery} loadingLabel="Loading plans…">
        {(plans) => {
          if (plans.length === 0) {
            return (
              <EmptyState title="No test plan yet">
                Generate a plan from your analysed requirements.
              </EmptyState>
            );
          }
          const sorted = [...plans].sort(
            (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
          );
          const selected = sorted.find((p) => p.id === selectedId) ?? sorted[0]!;
          return (
            <div className={L.split}>
              <div className={L.stack}>
                {sorted.length > 1 && (
                  <div className={L.row} style={{ gap: 6, flexWrap: 'wrap' }}>
                    {sorted.map((p) => (
                      <Button
                        key={p.id}
                        small
                        variant={p.id === selected.id ? 'primary' : 'ghost'}
                        onClick={() => setSelectedId(p.id)}
                      >
                        {p.title || p.id.slice(0, 8)} (v{p.version})
                      </Button>
                    ))}
                  </div>
                )}
                <Card
                  title={selected.title || `Test plan v${selected.version}`}
                  subtitle={`v${selected.version} · ${formatRelative(selected.updatedAt)}`}
                  actions={<StatusBadge status={selected.approvalStatus} />}
                >
                  {saveSections.isError && <ErrorBanner error={saveSections.error} />}
                  {saveSections.isSuccess && (
                    <Banner kind="success">
                      Sections saved as revision v{selected.version}.
                    </Banner>
                  )}
                  <SectionEditor
                    sections={selected.sections}
                    saving={saveSections.isPending}
                    onSave={(sections) => saveSections.mutate(sections)}
                  />
                </Card>

                <Card title="Approval gate (FR-TP-005)">
                  {approve.isError && <ErrorBanner error={approve.error} />}
                  <ApprovalControls
                    status={selected.approvalStatus}
                    invalidated={selected.approvalInvalidated}
                    busy={approve.isPending}
                    onDecide={(decision, comment) => approve.mutate({ decision, comment })}
                  />
                </Card>

                <Card title="Export (FR-TP-003)">
                  <div className={L.row}>
                    {(['md', 'json', 'docx', 'pdf'] as const).map((fmt) => (
                      <Button
                        key={fmt}
                        small
                        onClick={() =>
                          void downloadFile(
                            testPlansApi.exportUrl(selected.id, fmt),
                            `test-plan-v${selected.version}.${fmt}`,
                          )
                        }
                      >
                        {fmt.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </Card>
              </div>

              <RevisionsPanel planId={selected.id} projectId={projectId} />
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
