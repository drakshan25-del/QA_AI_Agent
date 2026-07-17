/**
 * In-app notification centre (FR-V3-ENT-007): unread badge, dropdown list,
 * mark-read / mark-all-read. Refreshes on `notification.new` envelopes from
 * the project event stream (pages already subscribe; the bell also polls as
 * a fallback so it works outside a project context).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../services/api/endpoints';
import { formatRelative } from '../lib/format';
import { Button } from './ui/Button';

export function NotificationBell(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const countQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 20_000,
  });
  const listQuery = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list(),
    enabled: open,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unread = countQuery.data ?? 0;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`Notifications (${unread} unread)`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: '1px solid var(--border, #30363d)',
          borderRadius: 6,
          color: 'inherit',
          cursor: 'pointer',
          padding: '4px 10px',
          position: 'relative',
        }}
      >
        🔔
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: 'var(--danger, #f85149)',
              color: '#fff',
              borderRadius: 10,
              fontSize: 10,
              minWidth: 16,
              height: 16,
              lineHeight: '16px',
              textAlign: 'center',
              padding: '0 3px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 360,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--surface, #161b22)',
            border: '1px solid var(--border, #30363d)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.4)',
            zIndex: 60,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              borderBottom: '1px solid var(--border, #30363d)',
            }}
          >
            <strong>Notifications</strong>
            <Button
              small
              variant="ghost"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {(listQuery.data ?? []).map((n) => (
              <li
                key={n.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border, #30363d)',
                  opacity: n.read ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ flex: 1, fontSize: 13 }}>{n.title}</strong>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>
                    {formatRelative(n.createdAt)}
                  </span>
                </div>
                {n.message && (
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                    {n.message}
                  </div>
                )}
                {!n.read && (
                  <Button
                    small
                    variant="ghost"
                    loading={markRead.isPending && markRead.variables === n.id}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            ))}
            {listQuery.isSuccess && (listQuery.data ?? []).length === 0 && (
              <li style={{ padding: 16, opacity: 0.7 }}>No notifications yet.</li>
            )}
            {listQuery.isLoading && (
              <li style={{ padding: 16, opacity: 0.7 }}>Loading…</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
