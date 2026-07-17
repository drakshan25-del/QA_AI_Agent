import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { ErrorBanner } from '../components/ui/Banner';
import { ProjectForm } from '../features/projects/ProjectForm';
import { projectsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import L from '../styles/layout.module.css';

export function ProjectNewPage(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <div className={L.stack}>
      <PageHeader title="New project" subtitle="Configure a QA project (FR-PROJ-001)" />
      <Card>
        {mutation.isError && <ErrorBanner error={mutation.error} />}
        <div style={{ marginTop: mutation.isError ? 12 : 0 }}>
          <ProjectForm
            submitLabel="Create project"
            submitting={mutation.isPending}
            onSubmit={(values) => mutation.mutate(values)}
          />
        </div>
      </Card>
    </div>
  );
}
