import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/Banner';
import { ValidationFindings } from '../features/automation/ValidationFindings';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { automationApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import L from '../styles/layout.module.css';

export function ValidationPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);

  const listQuery = useQuery({
    queryKey: qk.automation(projectId),
    queryFn: () => automationApi.list(projectId),
    enabled: !!projectId,
  });

  const validate = useMutation({
    mutationFn: (id: string) => automationApi.validate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.automation(projectId) }),
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Validation"
        subtitle="Static checks by file, rule, severity and location (FR-VAL-006)"
      />
      {validate.isError && <ErrorBanner error={validate.error} />}
      <QueryState query={listQuery} loadingLabel="Loading automation…">
        {(artifacts) =>
          artifacts.length === 0 ? (
            <EmptyState title="Nothing to validate">
              Generate automation first, then validate it here.
            </EmptyState>
          ) : (
            <div className={L.stack}>
              {artifacts.map((a) => (
                <Card
                  key={a.id}
                  title={a.path}
                  subtitle={`${a.kind} · v${a.version}`}
                  actions={
                    <div className={L.row}>
                      <StatusBadge status={a.validationStatus} label={`validation: ${a.validationStatus}`} />
                      <Button
                        small
                        loading={validate.isPending && validate.variables === a.id}
                        onClick={() => validate.mutate(a.id)}
                      >
                        Re-validate
                      </Button>
                    </div>
                  }
                >
                  <ValidationFindings report={a.validationReport} status={a.validationStatus} />
                </Card>
              ))}
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
