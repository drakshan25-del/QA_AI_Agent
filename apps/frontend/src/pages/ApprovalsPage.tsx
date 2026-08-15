import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import {
  automationApi,
  projectsApi,
  testCasesApi,
  testPlansApi,
} from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { ApprovalDecision, ApprovalResourceType } from '../services/api/types';
import { formatRelative } from '../lib/format';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

interface InboxRow {
  resourceType: ApprovalResourceType;
  id: string;
  label: string;
  status: string;
  invalidated: boolean;
  updatedAt: string;
  link: string;
}

export function ApprovalsPage(): JSX.Element {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>('');
  const [onlyPending, setOnlyPending] = useState(true);

  const projectsQuery = useQuery({ queryKey: qk.projects, queryFn: projectsApi.list });

  const plansQuery = useQuery({
    queryKey: qk.testPlans(projectId),
    queryFn: () => testPlansApi.list(projectId),
    enabled: !!projectId,
  });
  const casesQuery = useQuery({
    queryKey: qk.testCases(projectId, { pageSize: 200 }),
    queryFn: () => testCasesApi.list(projectId, { pageSize: 200 }),
    enabled: !!projectId,
  });
  const autoQuery = useQuery({
    queryKey: qk.automation(projectId),
    queryFn: () => automationApi.list(projectId),
    enabled: !!projectId,
  });

  const rows = useMemo<InboxRow[]>(() => {
    const out: InboxRow[] = [];
    for (const p of plansQuery.data ?? []) {
      out.push({
        resourceType: 'test_plan',
        id: p.id,
        label: p.title || `Test plan v${p.version}`,
        status: p.approvalStatus,
        invalidated: p.approvalInvalidated,
        updatedAt: p.updatedAt,
        link: `/projects/${projectId}/test-plan`,
      });
    }
    for (const c of casesQuery.data?.items ?? []) {
      out.push({
        resourceType: 'test_case',
        id: c.id,
        label: c.title,
        status: c.approvalStatus,
        invalidated: c.approvalInvalidated,
        updatedAt: c.updatedAt,
        link: `/projects/${projectId}/test-cases`,
      });
    }
    for (const a of autoQuery.data ?? []) {
      out.push({
        resourceType: 'automation',
        id: a.id,
        label: a.path,
        status: a.approvalStatus,
        invalidated: a.approvalInvalidated,
        updatedAt: a.updatedAt,
        link: `/projects/${projectId}/automation`,
      });
    }
    const filtered = onlyPending
      ? out.filter((r) => r.status === 'pending' || r.invalidated)
      : out;
    return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [plansQuery.data, casesQuery.data, autoQuery.data, onlyPending, projectId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.testPlans(projectId) });
    void qc.invalidateQueries({ queryKey: ['projects', projectId, 'test-cases'] });
    void qc.invalidateQueries({ queryKey: qk.automation(projectId) });
  };

  const decide = useMutation({
    mutationFn: async (input: { row: InboxRow; decision: ApprovalDecision }) => {
      const { row, decision } = input;
      if (row.resourceType === 'test_plan') await testPlansApi.approve(row.id, decision);
      else if (row.resourceType === 'automation') await automationApi.approve(row.id, decision);
      else await testCasesApi.approve([row.id], decision);
    },
    onSuccess: invalidate,
  });

  const loading = plansQuery.isLoading || casesQuery.isLoading || autoQuery.isLoading;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Approvals inbox"
        subtitle="Pending gates across plans, test cases and automation (FR-HITL-005)"
      />

      <QueryState query={projectsQuery} loadingLabel="Loading projects…">
        {(projects) => (
          <Card>
            <div className={L.row}>
              <label htmlFor="proj" className={L.muted}>
                Project
              </label>
              <select
                id="proj"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={{ padding: '7px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label className={L.row} style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={onlyPending}
                  onChange={(e) => setOnlyPending(e.target.checked)}
                />
                Only pending / invalidated
              </label>
            </div>
          </Card>
        )}
      </QueryState>

      {decide.isError && <ErrorBanner error={decide.error} />}

      {!projectId ? (
        <Banner kind="info">Select a project to review its approval gates.</Banner>
      ) : loading ? (
        <Card>Loading approvals…</Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing awaiting approval">
          All plans, cases and automation for this project are decided.
        </EmptyState>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Resource</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.resourceType}:${r.id}`}>
                  <td>
                    <StatusBadge status="info" label={r.resourceType.replace('_', ' ')} />
                  </td>
                  <td>
                    <Link to={r.link}>{r.label}</Link>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.invalidated && (
                      <div className={L.muted} style={{ fontSize: 11 }}>
                        invalidated by upstream
                      </div>
                    )}
                  </td>
                  <td className={L.muted}>{formatRelative(r.updatedAt)}</td>
                  <td>
                    <div className={L.row}>
                      <Button
                        small
                        variant="primary"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ row: r, decision: 'approved' })}
                      >
                        Approve
                      </Button>
                      <Button
                        small
                        variant="danger"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ row: r, decision: 'rejected' })}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
