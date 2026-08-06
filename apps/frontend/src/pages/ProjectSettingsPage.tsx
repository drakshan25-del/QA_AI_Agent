import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProjectForm } from '../features/projects/ProjectForm';
import { useProject, useProjectId } from '../features/projects/hooks';
import { projectsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { ProjectStatus, UpdateProjectInput } from '../services/api/types';
import L from '../styles/layout.module.css';

export function ProjectSettingsPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const projectQuery = useProject(projectId);

  const mutation = useMutation({
    mutationFn: (input: UpdateProjectInput) => projectsApi.update(projectId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });

  // The success banner should confirm, not persist forever.
  const { isSuccess, reset } = mutation;
  useEffect(() => {
    if (!isSuccess) return;
    const t = setTimeout(() => reset(), 4000);
    return () => clearTimeout(t);
  }, [isSuccess, reset]);

  return (
    <div className={L.stack}>
      <PageHeader title="Project settings" subtitle="Configuration and lifecycle (FR-PROJ-002/003)" />
      <QueryState query={projectQuery}>
        {(project) => (
          <>
            <Card
              title="Lifecycle"
              actions={<StatusBadge status={project.status} />}
              subtitle="Archive to hide from active work; reopen to resume."
            >
              <div className={L.row}>
                <Button
                  disabled={project.status === 'archived' || mutation.isPending}
                  onClick={() => mutation.mutate({ status: 'archived' as ProjectStatus })}
                >
                  Archive
                </Button>
                <Button
                  disabled={project.status === 'active' || mutation.isPending}
                  onClick={() => mutation.mutate({ status: 'active' as ProjectStatus })}
                >
                  Reopen
                </Button>
              </div>
            </Card>

            <Card
              title="Test case ID display (FR-V3-TC-004)"
              subtitle="Optional zero-padding for TC identifiers; the numeric value is always stored."
            >
              <div className={L.row}>
                {[0, 3, 4].map((pad) => (
                  <Button
                    key={pad}
                    small
                    variant={project.tcZeroPad === pad ? 'primary' : 'ghost'}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ tcZeroPad: pad })}
                  >
                    {pad === 0 ? 'TC-1' : `TC-${'1'.padStart(pad, '0')}`}
                  </Button>
                ))}
              </div>
            </Card>

            <Card title="Configuration">
              {mutation.isError && <ErrorBanner error={mutation.error} />}
              {mutation.isSuccess && !mutation.isError && (
                <Banner kind="success">Settings saved.</Banner>
              )}
              <div style={{ marginTop: 12 }}>
                {/* Keyed by project: navigating between projects' settings
                    must remount the form, never show or save stale values. */}
                <ProjectForm
                  key={project.id}
                  submitLabel="Save changes"
                  submitting={mutation.isPending}
                  initial={{
                    name: project.name,
                    description: project.description,
                    baseUrl: project.baseUrl,
                    allowedDomains: project.allowedDomains,
                    repository: project.repository,
                    environment: project.environment,
                    llmModel: project.llmModel,
                    llmTemperature: project.llmTemperature,
                    runner: project.runner,
                  }}
                  onSubmit={(values) => mutation.mutate(values)}
                />
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
