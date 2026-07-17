import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { Tabs } from '../components/ui/Tabs';
import { LazyCodeViewer } from '../components/LazyCodeViewer';
import { DiffViewer } from '../components/DiffViewer';
import { ApprovalControls } from '../features/approvals/ApprovalControls';
import { ValidationFindings } from '../features/automation/ValidationFindings';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import {
  automationApi,
  executionsApi,
  testCasesApi,
} from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { ApprovalDecision, GeneratedArtifact } from '../services/api/types';
import { toDisplayString } from '../lib/sanitize';
import L from '../styles/layout.module.css';
import s from '../features/automation/automation.module.css';

type Tab = 'code' | 'diff' | 'validation' | 'trace' | 'plan';

function ExecutionPlanTab({ artifactId }: { artifactId: string }): JSX.Element {
  const q = useQuery({
    queryKey: qk.executionPlan(artifactId),
    queryFn: () => automationApi.executionPlan(artifactId),
  });
  return (
    <QueryState query={q} loadingLabel="Loading execution plan…">
      {(plan) =>
        plan.plans.length === 0 ? (
          <p className={L.muted}>No execution plan available.</p>
        ) : (
          <div className={L.stack}>
            {plan.plans.map((p) => (
              <div key={p.testCaseId}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Test case {p.testCaseId.slice(0, 8)}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {p.steps.map((st) => (
                    <li key={st.sequence} style={{ marginBottom: 4 }}>
                      <StatusBadge status="idle" label={st.actionType} />{' '}
                      <span>{st.description}</span>
                      {st.target && <span className={L.mono}> → {st.target}</span>}
                      {st.expected && (
                        <div className={L.muted} style={{ fontSize: 12 }}>
                          expect: {st.expected}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )
      }
    </QueryState>
  );
}

function ArtifactDetail({
  artifact,
  projectId,
}: {
  artifact: GeneratedArtifact;
  projectId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('code');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.automation(projectId) });
    void qc.invalidateQueries({ queryKey: qk.automationItem(artifact.id) });
  };

  const validate = useMutation({
    mutationFn: () => automationApi.validate(artifact.id),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: (input: { decision: ApprovalDecision; comment: string }) =>
      automationApi.approve(artifact.id, input.decision, input.comment),
    onSuccess: invalidate,
  });
  const run = useMutation({
    mutationFn: () =>
      executionsApi.create({ projectId, automationIds: [artifact.id], browser: 'chromium' }),
    onSuccess: (res) => navigate(`/executions/${res.id}`),
  });

  const traceEntries = Object.entries(artifact.traceability ?? {});

  return (
    <div className={L.stack}>
      <Card
        title={artifact.path}
        subtitle={`${artifact.kind} · v${artifact.version} · ${artifact.status}`}
        actions={
          <div className={L.row}>
            <StatusBadge status={artifact.validationStatus} label={`validation: ${artifact.validationStatus}`} />
            <StatusBadge status={artifact.approvalStatus} />
          </div>
        }
      >
        <div className={L.row}>
          <Button small loading={validate.isPending} onClick={() => validate.mutate()}>
            Validate
          </Button>
          <Button
            small
            variant="primary"
            loading={run.isPending}
            disabled={artifact.approvalStatus !== 'approved' || artifact.status !== 'active'}
            title={
              artifact.approvalStatus !== 'approved'
                ? 'Automation must be approved before execution (FR-AUT-010)'
                : undefined
            }
            onClick={() => run.mutate()}
          >
            Run execution
          </Button>
        </div>
        {validate.isError && <ErrorBanner error={validate.error} />}
        {run.isError && <ErrorBanner error={run.error} />}
        {artifact.approvalStatus !== 'approved' && (
          <Banner kind="warn">
            Execution is gated on approval (FR-AUT-010). Approve this file to enable Run.
          </Banner>
        )}
      </Card>

      <Card noPad>
        <div style={{ padding: 'var(--space) var(--space) 0' }}>
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as Tab)}
            items={[
              { key: 'code', label: 'Code' },
              { key: 'diff', label: 'Diff' },
              { key: 'validation', label: 'Validation' },
              { key: 'trace', label: 'Traceability' },
              { key: 'plan', label: 'Execution plan' },
            ]}
          />
        </div>
        <div style={{ padding: '0 var(--space) var(--space)' }}>
          {tab === 'code' && <LazyCodeViewer path={artifact.path} content={artifact.content} />}
          {tab === 'diff' && <DiffViewer diff={artifact.diff} />}
          {tab === 'validation' && (
            <ValidationFindings report={artifact.validationReport} status={artifact.validationStatus} />
          )}
          {tab === 'trace' && (
            <div>
              <div className={L.muted} style={{ marginBottom: 8 }}>
                Linked test cases: {(artifact.testCaseIds ?? []).length}
              </div>
              {traceEntries.length === 0 ? (
                <p className={L.muted}>No traceability metadata.</p>
              ) : (
                <dl className={L.kv}>
                  {traceEntries.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k}</dt>
                      <dd style={{ whiteSpace: 'pre-wrap' }}>{toDisplayString(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
          {tab === 'plan' && <ExecutionPlanTab artifactId={artifact.id} />}
        </div>
      </Card>

      <Card title="Approval gate (FR-AUT-010)">
        {approve.isError && <ErrorBanner error={approve.error} />}
        <ApprovalControls
          status={artifact.approvalStatus}
          invalidated={artifact.approvalInvalidated}
          busy={approve.isPending}
          onDecide={(decision, comment) => approve.mutate({ decision, comment })}
        />
      </Card>
    </div>
  );
}

export function AutomationPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: qk.automation(projectId),
    queryFn: () => automationApi.list(projectId),
    enabled: !!projectId,
  });
  const approvedCasesQuery = useQuery({
    queryKey: qk.testCases(projectId, { approval: 'approved', pageSize: 200 }),
    queryFn: () => testCasesApi.list(projectId, { approval: 'approved', pageSize: 200 }),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (listQuery.data && listQuery.data.length > 0 && !selectedId) {
      setSelectedId(listQuery.data[0]!.id);
    }
  }, [listQuery.data, selectedId]);

  const approvedIds = (approvedCasesQuery.data?.items ?? []).map((c) => c.id);
  const generate = useMutation({
    mutationFn: () => automationApi.generate(projectId, approvedIds),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs(projectId) }),
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Automation"
        subtitle="Generated code, validation, traceability and execution plan (FR-AUT-*)"
        actions={
          <Button
            variant="primary"
            loading={generate.isPending}
            disabled={approvedIds.length === 0 || generate.isPending}
            title={approvedIds.length === 0 ? 'Approve test cases first (FR-TC-009)' : undefined}
            onClick={() => generate.mutate()}
          >
            Generate from {approvedIds.length} approved case{approvedIds.length === 1 ? '' : 's'}
          </Button>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}
      {generate.isSuccess && <Banner kind="info">Generation queued ({generate.data.status}).</Banner>}

      <QueryState query={listQuery} loadingLabel="Loading automation…">
        {(artifacts) =>
          artifacts.length === 0 ? (
            <EmptyState title="No automation generated">
              Approve test cases, then generate automation from them.
            </EmptyState>
          ) : (
            <div className={s.layout}>
              <Card title="Files" noPad>
                <ul className={s.tree}>
                  {artifacts.map((a) => (
                    <li key={a.id}>
                      <button
                        className={`${s.treeItem} ${a.id === selectedId ? s.treeItemActive : ''}`}
                        onClick={() => setSelectedId(a.id)}
                      >
                        <span className={s.treePath}>{a.path}</span>
                        <StatusBadge status={a.approvalStatus} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
              <div>
                {(() => {
                  const selected =
                    artifacts.find((a) => a.id === selectedId) ?? artifacts[0]!;
                  return <ArtifactDetail artifact={selected} projectId={projectId} />;
                })()}
              </div>
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
