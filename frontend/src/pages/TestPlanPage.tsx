import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
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
import type { ApprovalDecision } from '../services/api/types';
import { formatRelative } from '../lib/format';
import L from '../styles/layout.module.css';

export function TestPlanPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: qk.testPlans(projectId),
    queryFn: () => testPlansApi.list(projectId),
    enabled: !!projectId,
  });

  // Default-select the newest plan (highest version).
  useEffect(() => {
    if (plansQuery.data && plansQuery.data.length > 0 && !selectedId) {
      const newest = [...plansQuery.data].sort((a, b) => b.version - a.version)[0];
      if (newest) setSelectedId(newest.id);
    }
  }, [plansQuery.data, selectedId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.testPlans(projectId) });
    void qc.invalidateQueries({ queryKey: qk.project(projectId) });
  };

  const generate = useMutation({
    mutationFn: () => testPlansApi.generate(projectId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs(projectId) }),
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
        subtitle="Structured plan with approval gate and revisions (FR-TP-*)"
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
      {generate.isSuccess && <Banner kind="info">Generation queued ({generate.data.status}).</Banner>}

      <QueryState query={plansQuery} loadingLabel="Loading plans…">
        {(plans) => {
          if (plans.length === 0) {
            return (
              <EmptyState title="No test plan yet">
                Generate a plan from your analysed requirements.
              </EmptyState>
            );
          }
          const sorted = [...plans].sort((a, b) => b.version - a.version);
          const selected = sorted.find((p) => p.id === selectedId) ?? sorted[0]!;
          return (
            <div className={L.split}>
              <div className={L.stack}>
                <Card
                  title={selected.title || `Test plan v${selected.version}`}
                  subtitle={`v${selected.version} · ${formatRelative(selected.updatedAt)}`}
                  actions={<StatusBadge status={selected.approvalStatus} />}
                >
                  {saveSections.isError && <ErrorBanner error={saveSections.error} />}
                  {saveSections.isSuccess && <Banner kind="success">Sections saved.</Banner>}
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

              <Card title="Revision history (FR-TP-004)" subtitle={`${sorted.length} version(s)`}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {sorted.map((p) => (
                    <li
                      key={p.id}
                      style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
                    >
                      <button
                        onClick={() => setSelectedId(p.id)}
                        className={L.rowBetween}
                        style={{
                          width: '100%',
                          background: p.id === selected.id ? 'var(--surface-2)' : 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 8,
                          borderRadius: 6,
                          color: 'var(--text)',
                          textAlign: 'left',
                        }}
                      >
                        <span>
                          <strong>v{p.version}</strong>{' '}
                          <span className={L.muted}>{formatRelative(p.updatedAt)}</span>
                        </span>
                        <StatusBadge status={p.approvalStatus} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
