import { Link, useNavigate } from 'react-router-dom';
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
import { formatRelative } from '../lib/format';
import { isAdminRole } from '../services/api/types';
import type { AuditEvent, Project, Paginated } from '../services/api/types';
import L from '../styles/layout.module.css';

// Non-admin audit queries must be project-scoped (server-enforced), so
// non-admins see their first project's activity instead of a 403 banner.
function RecentActivity({ projects }: { projects: Project[] | undefined }): JSX.Element {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);
  const projectId = projects?.[0]?.id;
  const filter: AuditFilter = isAdmin ? { limit: 12 } : { limit: 12, projectId };
  const q = useQuery({
    queryKey: qk.audit(filter),
    queryFn: () => auditApi.list(filter),
    enabled: isAdmin || !!projectId,
  });
  const subtitle = isAdmin
    ? 'Latest audited actions across the platform'
    : 'Latest audited actions in your projects';
  return (
    <Card title="Recent activity" subtitle={subtitle}>
      {!isAdmin && !projectId ? (
        <p className={L.muted}>No activity yet.</p>
      ) : (
      <QueryState query={q} loadingLabel="Loading activity…">
        {(data) => {
          const events: AuditEvent[] = Array.isArray(data)
            ? data
            : (data as Paginated<AuditEvent>).items ?? [];
          if (events.length === 0) return <p className={L.muted}>No activity yet.</p>;
          return (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {events.map((e) => (
                <li key={e.id} className={L.rowBetween} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>
                    <strong>{e.action}</strong>{' '}
                    <span className={L.muted}>
                      {e.resourceType}
                      {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}` : ''}
                    </span>
                    <div className={L.muted} style={{ fontSize: 12 }}>
                      {e.actor || 'system'} · {formatRelative(e.createdAt)}
                    </div>
                  </span>
                  <StatusBadge status={e.result} />
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
      )}
    </Card>
  );
}

function ProjectCard({ project }: { project: Project }): JSX.Element {
  return (
    <Link to={`/projects/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Card
        title={project.name}
        subtitle={project.description || project.baseUrl || 'No description'}
        actions={<StatusBadge status={project.status} />}
      >
        <dl className={L.kv}>
          <dt>Runner</dt>
          <dd>{project.runner}</dd>
          <dt>Environment</dt>
          <dd>{project.environment}</dd>
          <dt>Model</dt>
          <dd>{project.llmModel || '—'}</dd>
        </dl>
      </Card>
    </Link>
  );
}

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const projectsQuery = useQuery({ queryKey: qk.projects, queryFn: projectsApi.list });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Dashboard"
        subtitle="Your QA projects and recent activity"
        actions={
          <Button variant="primary" onClick={() => navigate('/projects/new')}>
            New project
          </Button>
        }
      />

      <QueryState query={projectsQuery} loadingLabel="Loading projects…">
        {(projects) =>
          projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              action={
                <Button variant="primary" onClick={() => navigate('/projects/new')}>
                  Create your first project
                </Button>
              }
            >
              Create a project to upload requirements and start generating tests.
            </EmptyState>
          ) : (
            <div className={L.grid}>
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )
        }
      </QueryState>

      <RecentActivity projects={projectsQuery.data} />
    </div>
  );
}
