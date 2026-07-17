import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { auditApi, type AuditFilter } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
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

export function AuditPage(): JSX.Element {
  const [draft, setDraft] = useState<AuditFilter>({ limit: 50 });
  const [applied, setApplied] = useState<AuditFilter>({ limit: 50 });

  const q = useQuery({
    queryKey: qk.audit(applied),
    queryFn: () => auditApi.list(applied),
  });

  const set = (patch: Partial<AuditFilter>) => setDraft((prev) => ({ ...prev, ...patch }));

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
          <input
            aria-label="Project id"
            placeholder="Project id"
            style={controlStyle}
            value={draft.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || undefined })}
          />
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
          <Button variant="primary" small onClick={() => setApplied(draft)}>
            Search
          </Button>
          <Button
            variant="ghost"
            small
            onClick={() => {
              setDraft({ limit: 50 });
              setApplied({ limit: 50 });
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
          if (events.length === 0) {
            return <EmptyState title="No audit events match your filters" />;
          }
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
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
