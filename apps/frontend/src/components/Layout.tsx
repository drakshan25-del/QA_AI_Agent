import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import s from './layout.module.css';
import { useAuth } from '../auth/AuthContext';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';
import { NotificationBell } from './NotificationBell';
import { healthApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';

/** Extract the active project id from the URL for the project sub-navigation. */
function useActiveProjectId(): string | null {
  const { pathname } = useLocation();
  const m = /\/projects\/([^/]+)/.exec(pathname);
  const id = m?.[1];
  if (!id || id === 'new') return null;
  return id;
}

const projectLinks = (id: string): Array<{ to: string; label: string; end?: boolean }> => [
  { to: `/projects/${id}`, label: 'Overview', end: true },
  { to: `/projects/${id}/upload`, label: 'Uploads' },
  { to: `/projects/${id}/analysis`, label: 'Analysis' },
  { to: `/projects/${id}/test-plan`, label: 'Test Plan' },
  { to: `/projects/${id}/test-cases`, label: 'Test Cases' },
  { to: `/projects/${id}/automation`, label: 'Automation' },
  { to: `/projects/${id}/validation`, label: 'Validation' },
  { to: `/projects/${id}/regression`, label: 'Regression' },
  { to: `/projects/${id}/reports`, label: 'Reports' },
  { to: `/projects/${id}/settings`, label: 'Settings' },
];

function HealthPill(): JSX.Element {
  const q = useQuery({
    queryKey: qk.health,
    queryFn: healthApi.get,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  if (q.isLoading || !q.data) return <StatusBadge status="loading" label="checking" />;
  return <StatusBadge status={q.data.status} label={`system: ${q.data.status}`} />;
}

export function Layout(): JSX.Element {
  const { user, logout } = useAuth();
  const projectId = useActiveProjectId();

  return (
    <div className={s.shell}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={s.topbar}>
        <div className={s.brand}>
          <span className={s.logo} aria-hidden="true">
            QA
          </span>
          <span>Agentic AI System</span>
          <span className={s.version}>v3</span>
        </div>
        <div className={s.topRight}>
          <HealthPill />
          <NotificationBell />
          {user && (
            <span className={s.user}>
              {user.name || user.email} · <span className={s.role}>{user.role}</span>
            </span>
          )}
          <Button small variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className={s.body}>
        <nav className={s.sidebar} aria-label="Primary">
          <div className={s.navGroup}>
            <div className={s.navLabel}>Workspace</div>
            <NavLink to="/dashboard" className={({ isActive }) => navCls(isActive)}>
              Dashboard
            </NavLink>
            <NavLink to="/approvals" className={({ isActive }) => navCls(isActive)}>
              Approvals
            </NavLink>
            <NavLink to="/audit" className={({ isActive }) => navCls(isActive)}>
              Audit
            </NavLink>
            <NavLink to="/projects/new" className={({ isActive }) => navCls(isActive)}>
              + New project
            </NavLink>
          </div>

          {projectId && (
            <div className={s.navGroup}>
              <div className={s.navLabel}>Project</div>
              {projectLinks(projectId).map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => navCls(isActive)}
                >
                  {l.label}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <main id="main" className={s.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function navCls(isActive: boolean): string {
  return `${s.navLink} ${isActive ? s.navLinkActive : ''}`;
}
