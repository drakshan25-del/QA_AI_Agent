import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { auditApi, projectsApi, type AuditFilter } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { isAdminRole } from '../services/api/types';
import type { AuditEvent, Paginated } from '../services/api/types';
import { formatDate } from '../lib/format';
import { toDisplayString } from '../lib/sanitize';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

const controlStyle = {
  padding: '7px 9px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

const PAGE_SIZE = 50;

export function AuditPage(): JSX.Element {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);
  const [draft, setDraft] = useState<AuditFilter>({ limit: PAGE_SIZE });
  const [applied, setApplied] = useState<AuditFilter>({ limit: PAGE_SIZE });

  const projectsQuery = useQuery({
    queryKey: qk.projects,
    queryFn: () => projectsApi.list(),
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  // Non-admin audit queries must be project-scoped (server-enforced);
  // default to the user's first project instead of erroring on load.
  useEffect(() => {
    if (isAdmin || draft.projectId || projects.length === 0) return;
    const first = projects[0]!.id;
    setDraft((prev) => ({ ...prev, projectId: first }));
    setApplied((prev) => ({ ...prev, projectId: first }));
  }, [isAdmin, projects, draft.projectId]);

  const q = useQuery({
    queryKey: qk.audit(applied),
    queryFn: () => auditApi.list(applied),
    enabled: isAdmin || !!applied.projectId,
  });

  const set = (patch: Partial<AuditFilter>) => setDraft((prev) => ({ ...prev, ...patch }));
  const offset = applied.offset ?? 0;

  return (
    <div className={L.stack}>
      <PageHeader title="Audit history" subtitle="Searchable, append-only trail (FR-AUD-004)" />

      <Card title="Filters">
        <div className={L.row}>
          <input
            aria-label="Actor"
            placeholder="Actor (email)"
            style={controlStyle}
            value={draft.actor ?? ''}
            onChange={(e) => set({ actor: e.target.value || undefined })}
          />
          <input
            aria-label="Action"
            placeholder="Action"
            style={controlStyle}
            value={draft.action ?? ''}
            onChange={(e) => set({ action: e.target.value || undefined })}
          />
          <input
            aria-label="Resource type"
            placeholder="Resource type"
            style={controlStyle}
            value={draft.resourceType ?? ''}
            onChange={(e) => set({ resourceType: e.target.value || undefined })}
          />
          <select
            aria-label="Project"
            style={controlStyle}
            value={draft.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || undefined })}
          >
            {isAdmin && <option value="">All projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className={L.muted}>
            From{' '}
            <input
              type="date"
              style={controlStyle}
              value={draft.from ?? ''}
              onChange={(e) => set({ from: e.target.value || undefined })}
            />
          </label>
          <label className={L.muted}>
            To{' '}
            <input
              type="date"
              style={controlStyle}
              value={draft.to ?? ''}
              onChange={(e) => set({ to: e.target.value || undefined })}
            />
          </label>
          <Button
            variant="primary"
            small
            onClick={() => setApplied({ ...draft, offset: 0 })}
          >
            Search
          </Button>
          <Button
            variant="ghost"
            small
            onClick={() => {
              const base: AuditFilter = {
                limit: PAGE_SIZE,
                ...(isAdmin ? {} : { projectId: draft.projectId }),
              };
              setDraft(base);
              setApplied(base);
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      <QueryState query={q} loadingLabel="Loading audit events…">
        {(data) => {
          const events: AuditEvent[] = Array.isArray(data)
            ? data
            : (data as Paginated<AuditEvent>).items ?? [];
          if (events.length === 0 && offset === 0) {
            return <EmptyState title="No audit events match your filters" />;
          }
          const pager = (
            <div className={L.row} style={{ marginTop: 10 }}>
              <Button
                small
                variant="ghost"
                disabled={offset === 0}
                onClick={() =>
                  setApplied((prev) => ({
                    ...prev,
                    offset: Math.max(0, (prev.offset ?? 0) - PAGE_SIZE),
                  }))
                }
              >
                Previous
              </Button>
              <span className={L.muted}>
                {offset + 1}–{offset + events.length}
              </span>
              <Button
                small
                variant="ghost"
                disabled={events.length < PAGE_SIZE}
                onClick={() =>
                  setApplied((prev) => ({
                    ...prev,
                    offset: (prev.offset ?? 0) + PAGE_SIZE,
                  }))
                }
              >
                Next
              </Button>
            </div>
          );
          return (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Result</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className={L.muted} style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(e.createdAt)}
                      </td>
                      <td>{e.actor || 'system'}</td>
                      <td className={L.mono}>{e.action}</td>
                      <td>
                        {e.resourceType}
                        {e.resourceId ? (
                          <div className={L.muted} style={{ fontSize: 11 }}>
                            {e.resourceId.slice(0, 12)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge status={e.result} />
                      </td>
                      <td className={L.muted} style={{ maxWidth: 260, fontSize: 12 }}>
                        {e.metadata ? toDisplayString(e.metadata).slice(0, 140) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pager}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
