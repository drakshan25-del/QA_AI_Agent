import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/Banner';
import { usersApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import type { PublicUser } from '../services/api/types';
import { formatDate, humanCategory } from '../lib/format';
import ui from '../components/ui/ui.module.css';
import L from '../styles/layout.module.css';

/**
 * Account administration — visible to the superowner only. Lists every
 * account and lets the superowner enable/disable sign-in for each one.
 */
export function AccountsPage(): JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: qk.users,
    queryFn: usersApi.list,
    enabled: user?.role === 'superowner',
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.setStatus(id, isActive),
    onMutate: () => setError(null),
    onError: (err) => setError(err),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.users }),
  });

  if (user && user.role !== 'superowner') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className={L.stack}>
      <PageHeader
        title="Accounts"
        subtitle="Enable or disable access for every account on the platform"
      />

      {error != null && <ErrorBanner error={error} />}

      <QueryState query={q} loadingLabel="Loading accounts…">
        {(accounts: PublicUser[]) => {
          if (accounts.length === 0) {
            return <EmptyState title="No accounts yet" />;
          }
          return (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const isSelf = a.id === user?.id;
                    const locked = isSelf || a.role === 'superowner';
                    return (
                      <tr key={a.id}>
                        <td>
                          {a.name || <span className={L.muted}>—</span>}
                          {isSelf && <span className={L.muted}> (you)</span>}
                        </td>
                        <td>{a.email}</td>
                        <td>{humanCategory(a.role)}</td>
                        <td>{formatDate(a.createdAt)}</td>
                        <td>
                          {a.isActive ? (
                            <StatusBadge status="active" label="Active" />
                          ) : (
                            <StatusBadge status="failed" label="Disabled" />
                          )}
                        </td>
                        <td>
                          {locked ? (
                            <span className={L.muted}>—</span>
                          ) : (
                            <Button
                              small
                              variant={a.isActive ? 'ghost' : 'primary'}
                              disabled={toggle.isPending}
                              onClick={() =>
                                toggle.mutate({ id: a.id, isActive: !a.isActive })
                              }
                            >
                              {a.isActive ? 'Disable' : 'Enable'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
