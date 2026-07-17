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

            <Card title="Configuration">
              {mutation.isError && <ErrorBanner error={mutation.error} />}
              {mutation.isSuccess && !mutation.isError && (
                <Banner kind="success">Settings saved.</Banner>
              )}
              <div style={{ marginTop: 12 }}>
                <ProjectForm
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
