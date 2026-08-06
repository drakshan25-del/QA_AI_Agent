import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { LiveJobConsole } from '../components/LiveJobConsole';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/Banner';
import { Progress } from '../components/ui/Progress';
import { TestCaseEditModal } from '../features/test-cases/TestCaseEditModal';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { requirementsApi, testCasesApi, type TestCaseFilter } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { ApprovalDecision, TestCase } from '../services/api/types';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

const emptyFilter: TestCaseFilter = { page: 1, pageSize: 25 };

function CoveragePanel({ projectId }: { projectId: string }): JSX.Element {
  const q = useQuery({
    queryKey: qk.coverage(projectId),
    queryFn: () => testCasesApi.coverage(projectId),
    enabled: !!projectId,
  });
  return (
    <Card title="Requirement coverage" subtitle="Traceability indicators (FR-TC-006)">
      <QueryState query={q} loadingLabel="Loading coverage…">
        {(cov) => (
          <>
            <div className={L.rowBetween} style={{ marginBottom: 8 }}>
              <strong>
                {cov.coveredRequirements}/{cov.totalRequirements} requirements covered
              </strong>
              <span className={L.muted}>{cov.coveragePercent}%</span>
            </div>
            <Progress value={cov.coveragePercent} />
            <div className={L.tagList} style={{ marginTop: 12 }}>
              {cov.perRequirement.map((r) => (
                <span
                  key={r.requirementId}
                  title={`${r.title} — ${r.testCaseCount} cases, ${r.approvedCount} approved`}
                >
                  <StatusBadge
                    status={r.covered ? (r.approvedCount > 0 ? 'approved' : 'pending') : 'failed'}
                    label={`${r.title?.slice(0, 18) || r.requirementId.slice(0, 8)} (${r.testCaseCount})`}
                  />
                </span>
              ))}
            </div>
          </>
        )}
      </QueryState>
    </Card>
  );
}

const controlStyle = {
  padding: '7px 9px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

export function TestCasesPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);

  const [filter, setFilter] = useState<TestCaseFilter>(emptyFilter);
  // Debounced copy drives the query so typing in Search doesn't fire one
  // request (and one full table swap) per keystroke.
  const [debouncedFilter, setDebouncedFilter] = useState<TestCaseFilter>(emptyFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const setF = (patch: Partial<TestCaseFilter>) =>
    setFilter((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filter), 250);
    return () => clearTimeout(t);
  }, [filter]);

  const listQuery = useQuery({
    queryKey: qk.testCases(projectId, debouncedFilter),
    queryFn: () => testCasesApi.list(projectId, debouncedFilter),
    enabled: !!projectId,
    // Keep the previous page rendered while the next loads — no full-page
    // spinner flash on every filter/page change.
    placeholderData: keepPreviousData,
  });
  const requirementsQuery = useQuery({
    queryKey: qk.requirements(projectId),
    queryFn: () => requirementsApi.list(projectId),
    enabled: !!projectId,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['projects', projectId, 'test-cases'] });
    void qc.invalidateQueries({ queryKey: qk.coverage(projectId) });
    void qc.invalidateQueries({ queryKey: qk.project(projectId) });
  };

  const generate = useMutation({
    mutationFn: () =>
      testCasesApi.generate(projectId, (requirementsQuery.data ?? []).map((r) => r.id)),
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      void qc.invalidateQueries({ queryKey: qk.jobs(projectId) });
    },
  });
  const bulkApprove = useMutation({
    mutationFn: (input: { ids: string[]; decision: ApprovalDecision }) =>
      testCasesApi.approve(input.ids, input.decision),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
  });
  const edit = useMutation({
    mutationFn: (input: { id: string; patch: Partial<TestCase> }) =>
      testCasesApi.update(input.id, input.patch),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reqCount = requirementsQuery.data?.length ?? 0;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Test cases"
        subtitle="Search, filter, trace and approve (FR-TC-*)"
        actions={
          <Button
            variant="primary"
            loading={generate.isPending}
            disabled={reqCount === 0 || generate.isPending}
            onClick={() => generate.mutate()}
          >
            Generate from {reqCount} requirement{reqCount === 1 ? '' : 's'}
          </Button>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}
      {activeJobId && (
        <LiveJobConsole
          projectId={projectId}
          jobId={activeJobId}
          onRetried={setActiveJobId}
          title="Generating test cases"
          onFinished={invalidate}
        />
      )}

      <CoveragePanel projectId={projectId} />

      <Card title="Filters">
        <div className={L.row}>
          <input
            aria-label="Search test cases"
            placeholder="Search…"
            style={{ ...controlStyle, minWidth: 180 }}
            value={filter.q ?? ''}
            onChange={(e) => setF({ q: e.target.value || undefined })}
          />
          <select
            aria-label="Filter by source"
            style={controlStyle}
            value={filter.source ?? ''}
            onChange={(e) => setF({ source: e.target.value || undefined })}
          >
            <option value="">All sources</option>
            <option value="ai">AI</option>
            <option value="manual">Manual</option>
          </select>
          <select
            aria-label="Filter by priority"
            style={controlStyle}
            value={filter.priority ?? ''}
            onChange={(e) => setF({ priority: e.target.value || undefined })}
          >
            <option value="">All priorities</option>
            {['critical', 'high', 'medium', 'low'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            style={controlStyle}
            value={filter.type ?? ''}
            onChange={(e) => setF({ type: e.target.value || undefined })}
          >
            <option value="">All types</option>
            {['positive', 'negative', 'edge', 'boundary', 'security', 'performance'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by approval"
            style={controlStyle}
            value={filter.approval ?? ''}
            onChange={(e) => setF({ approval: e.target.value || undefined })}
          >
            <option value="">All approvals</option>
            {['pending', 'approved', 'rejected'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by automation"
            style={controlStyle}
            value={filter.automation ?? ''}
            onChange={(e) => setF({ automation: e.target.value || undefined })}
          >
            <option value="">All automation</option>
            {['none', 'generated', 'approved', 'validated'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button small variant="ghost" onClick={() => setFilter(emptyFilter)}>
            Reset
          </Button>
        </div>
      </Card>

      {selected.size > 0 && (
        <Card>
          <div className={L.rowBetween}>
            <strong>{selected.size} selected</strong>
            <div className={L.row}>
              <Button
                small
                variant="primary"
                loading={bulkApprove.isPending}
                onClick={() => bulkApprove.mutate({ ids: [...selected], decision: 'approved' })}
              >
                Approve
              </Button>
              <Button
                small
                variant="danger"
                onClick={() => bulkApprove.mutate({ ids: [...selected], decision: 'rejected' })}
              >
                Reject
              </Button>
              <Button
                small
                onClick={() => bulkApprove.mutate({ ids: [...selected], decision: 'regenerate' })}
              >
                Regenerate
              </Button>
              <Button small variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        </Card>
      )}
      {bulkApprove.isError && <ErrorBanner error={bulkApprove.error} />}

      <QueryState query={listQuery} loadingLabel="Loading test cases…">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState title="No test cases match">
              Adjust filters or generate cases from approved requirements.
            </EmptyState>
          ) : (
            <>
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          aria-label="Select all on page"
                          checked={page.items.every((c) => selected.has(c.id))}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              for (const c of page.items) {
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                              }
                              return next;
                            })
                          }
                        />
                      </th>
                      <th>Case</th>
                      <th>Priority</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Traceability</th>
                      <th>Automation</th>
                      <th>Approval</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((tc) => (
                      <tr key={tc.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${tc.title}`}
                            checked={selected.has(tc.id)}
                            onChange={() => toggleRow(tc.id)}
                          />
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {tc.humanId ? `${tc.humanId} - ` : ''}
                            {tc.title}
                          </div>
                          <div className={L.muted} style={{ fontSize: 12 }}>
                            {tc.caseKey}
                            {tc.objective ? ` · ${tc.objective.slice(0, 60)}` : ''}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={tc.priority} label={tc.priority} />
                        </td>
                        <td>{tc.category}</td>
                        <td>{tc.source}</td>
                        <td>
                          <span className={L.muted}>
                            {(tc.requirementIds ?? []).length} req
                            {(tc.requirementIds ?? []).length === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={tc.automationStatus} label={tc.automationStatus} />
                        </td>
                        <td>
                          <StatusBadge status={tc.approvalStatus} />
                          {tc.approvalInvalidated && (
                            <div className={L.muted} style={{ fontSize: 11 }}>
                              invalidated
                            </div>
                          )}
                        </td>
                        <td>
                          <Button small variant="ghost" onClick={() => setEditing(tc)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={L.rowBetween}>
                <span className={L.muted}>
                  {page.total} total · page {page.page} of{' '}
                  {Math.max(1, Math.ceil(page.total / page.pageSize))}
                </span>
                <div className={L.row}>
                  <Button
                    small
                    disabled={page.page <= 1}
                    onClick={() => setFilter((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}
                  >
                    Previous
                  </Button>
                  <Button
                    small
                    disabled={page.page >= Math.ceil(page.total / page.pageSize)}
                    onClick={() => setFilter((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )
        }
      </QueryState>

      {editing && (
        <TestCaseEditModal
          testCase={editing}
          open={!!editing}
          saving={edit.isPending}
          error={edit.isError ? edit.error : undefined}
          onClose={() => setEditing(null)}
          onSave={(patch) => edit.mutate({ id: editing.id, patch })}
        />
      )}
    </div>
  );
}
