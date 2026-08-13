import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { LiveJobConsole } from '../components/LiveJobConsole';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { Tabs } from '../components/ui/Tabs';
import { LazyCodeEditor } from '../components/LazyCodeEditor';
import { DiffViewer } from '../components/DiffViewer';
import { ApprovalControls } from '../features/approvals/ApprovalControls';
import { RunLauncher } from '../features/executions/RunLauncher';
import { ValidationFindings } from '../features/automation/ValidationFindings';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { automationApi, testCasesApi } from '../services/api/endpoints';
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
        (plan.plans ?? []).length === 0 ? (
          <p className={L.muted}>
            No execution plan is available yet — it appears once the automation
            artefact is linked to approved test cases.
          </p>
        ) : (
          <div className={L.stack}>
            {(plan.plans ?? []).map((p, idx) => (
              <div key={p.testCaseId || idx}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {p.caseKey || `Test case ${(p.testCaseId || '').slice(0, 8)}`}
                  {p.title ? ` — ${p.title.replace(/^TC-\d+:\s*/, '')}` : ''}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {(p.steps ?? []).map((st) => (
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
  const [tab, setTab] = useState<Tab>('code');
  const [validationJobId, setValidationJobId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  // Editable code (AC-002) + unsaved-changes tracking (AC-003). `draft` is
  // the working copy; it is dirty when it diverges from the saved artifact.
  const [draft, setDraft] = useState(artifact.content);
  const [savedContent, setSavedContent] = useState(artifact.content);
  const dirty = draft !== savedContent;

  // A server-side change to the SAME artifact (e.g. regeneration/validation)
  // updates the baseline only when the user has no unsaved edits, so a
  // background refetch never silently discards in-progress work.
  useEffect(() => {
    if (!dirty && artifact.content !== savedContent) {
      setSavedContent(artifact.content);
      setDraft(artifact.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.content]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.automation(projectId) });
    void qc.invalidateQueries({ queryKey: qk.automationItem(artifact.id) });
  };

  const save = useMutation({
    mutationFn: () => automationApi.update(artifact.id, draft),
    onSuccess: (updated) => {
      // Latest saved version replaces the previous (AC-004).
      setSavedContent(updated.content);
      setDraft(updated.content);
      invalidate();
    },
  });

  // Warn before leaving with unsaved edits — in-app navigation (AC-003)…
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        dirty && currentLocation.pathname !== nextLocation.pathname,
      [dirty],
    ),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const leave = window.confirm(
      'You have unsaved changes to the automation code. Leave without saving?',
    );
    if (leave) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // …and hard reload / tab close.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Validation is an async job with a live log console (FR-V3-LOG-005).
  const validate = useMutation({
    mutationFn: () => automationApi.validate(artifact.id),
    onSuccess: (res) => {
      const jobId = (res as { jobId?: string }).jobId;
      if (jobId) setValidationJobId(jobId);
      invalidate();
    },
  });
  const overrideValidation = useMutation({
    mutationFn: () => automationApi.overrideValidation(artifact.id, overrideReason),
    onSuccess: () => {
      setOverrideReason('');
      invalidate();
    },
  });
  const approve = useMutation({
    mutationFn: (input: { decision: ApprovalDecision; comment: string }) =>
      automationApi.approve(artifact.id, input.decision, input.comment),
    onSuccess: invalidate,
  });

  const validated = ['passed', 'passed_with_warnings', 'overridden'].includes(
    artifact.validationStatus,
  );
  const runnable =
    artifact.approvalStatus === 'approved' && artifact.status === 'active' && validated;
  const traceEntries = Object.entries(artifact.traceability ?? {});

  return (
    <div className={L.stack}>
      <Card
        title={artifact.path}
        subtitle={`${artifact.kind} · ${artifact.testType ?? 'ui'}${
          artifact.regressionSuite ? ' · regression' : ''
        } · v${artifact.version} · ${artifact.status}`}
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
        </div>
        {validate.isError && <ErrorBanner error={validate.error} />}
        {validationJobId && (
          <div style={{ marginTop: 10 }}>
            <LiveJobConsole
              projectId={projectId}
              jobId={validationJobId}
              onRetried={setValidationJobId}
              title={`Validating ${artifact.path}`}
              onFinished={invalidate}
            />
          </div>
        )}
        {artifact.validationStatus === 'failed' && (
          <div style={{ marginTop: 10 }}>
            <Banner kind="warn">
              Validation failed. An authorised role can record a governed
              validation exception (FR-V3-ENT-002) with a written reason.
            </Banner>
            <div className={L.row} style={{ marginTop: 6 }}>
              <input
                aria-label="Override reason"
                placeholder="Reason for validation exception…"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <Button
                small
                variant="danger"
                disabled={!overrideReason.trim()}
                loading={overrideValidation.isPending}
                onClick={() => overrideValidation.mutate()}
              >
                Override validation
              </Button>
            </div>
            {overrideValidation.isError && (
              <ErrorBanner error={overrideValidation.error} />
            )}
          </div>
        )}
        {artifact.approvalStatus !== 'approved' && (
          <Banner kind="warn">
            Execution is gated on approval (FR-AUT-010). Approve this file to enable Run.
          </Banner>
        )}
      </Card>

      <Card
        title="Run Execution (§23.3)"
        subtitle="Approved + validated scripts run with live step streaming"
      >
        <RunLauncher
          projectId={projectId}
          automationIds={[artifact.id]}
          disabled={!runnable}
          disabledReason="Automation must be approved and validated before execution (FR-AUT-010)."
        />
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
          {tab === 'code' && (
            <div className={L.stack} style={{ gap: 10 }}>
              <div className={L.row} style={{ alignItems: 'center' }}>
                <span className={L.muted} style={{ fontSize: 12 }}>
                  {dirty ? (
                    <strong style={{ color: 'var(--warn, #d29922)' }}>
                      ● Unsaved changes
                    </strong>
                  ) : (
                    'Saved'
                  )}
                </span>
                <div className={L.spacer} />
                <Button
                  small
                  variant="ghost"
                  disabled={!dirty || save.isPending}
                  onClick={() => setDraft(savedContent)}
                >
                  Revert
                </Button>
                <Button
                  small
                  variant="primary"
                  disabled={!dirty}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  Save
                </Button>
              </div>
              {save.isError && <ErrorBanner error={save.error} />}
              {save.isSuccess && !dirty && (
                <Banner kind="success">
                  Code saved (v{artifact.version}). Re-validate and re-approve
                  before executing (FR-VAL-007).
                </Banner>
              )}
              <LazyCodeEditor path={artifact.path} value={draft} onChange={setDraft} />
            </div>
          )}
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [testType, setTestType] = useState<'ui' | 'api'>('ui');
  const [regressionSuite, setRegressionSuite] = useState(false);

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
    mutationFn: () =>
      automationApi.generate(projectId, approvedIds, { testType, regressionSuite }),
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: qk.jobs(projectId) });
    },
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Automation"
        subtitle="Generated code, validation, traceability and execution plan (FR-AUT-*)"
        actions={
          <div className={L.row} style={{ gap: 8, alignItems: 'end' }}>
            <Select
              label="Test type"
              value={testType}
              onChange={(e) => setTestType(e.target.value as 'ui' | 'api')}
              style={{ width: 90 }}
            >
              <option value="ui">UI</option>
              <option value="api">API</option>
            </Select>
            <label className={L.row} style={{ gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                aria-label="Regression suite"
                checked={regressionSuite}
                onChange={(e) => setRegressionSuite(e.target.checked)}
              />
              <span>Regression suite</span>
            </label>
            <Button
              variant="primary"
              loading={generate.isPending}
              disabled={approvedIds.length === 0 || generate.isPending}
              title={approvedIds.length === 0 ? 'Approve test cases first (FR-TC-009)' : undefined}
              onClick={() => generate.mutate()}
            >
              Generate from {approvedIds.length} approved case{approvedIds.length === 1 ? '' : 's'}
            </Button>
          </div>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}
      {activeJobId && (
        <LiveJobConsole
          projectId={projectId}
          jobId={activeJobId}
          title="Generating Playwright automation"
          onFinished={() => void qc.invalidateQueries({ queryKey: qk.automation(projectId) })}
          onRetried={setActiveJobId}
        />
      )}

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
                        {a.testType && (
                          <StatusBadge
                            status="idle"
                            label={`${a.testType}${a.regressionSuite ? ' · regression' : ''}`}
                          />
                        )}
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
                  // Keyed by artifact so per-file state (active validation
                  // console, override reason, tab) never leaks across files.
                  return (
                    <ArtifactDetail
                      key={selected.id}
                      artifact={selected}
                      projectId={projectId}
                    />
                  );
                })()}
              </div>
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
