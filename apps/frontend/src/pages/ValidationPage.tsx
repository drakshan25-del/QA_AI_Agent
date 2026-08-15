import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { LiveJobConsole } from '../components/LiveJobConsole';
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
  const [activeJob, setActiveJob] = useState<{ jobId: string; path: string } | null>(
    null,
  );

  const listQuery = useQuery({
    queryKey: qk.automation(projectId),
    queryFn: () => automationApi.list(projectId),
    enabled: !!projectId,
  });

  // Validation runs as an async job with a live console (FR-V3-LOG-005).
  const validate = useMutation({
    mutationFn: (input: { id: string; path: string }) =>
      automationApi.validate(input.id),
    onSuccess: (res, input) => {
      const jobId = (res as { jobId?: string }).jobId;
      if (jobId) setActiveJob({ jobId, path: input.path });
      void qc.invalidateQueries({ queryKey: qk.automation(projectId) });
    },
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Validation"
        subtitle="Static checks by file, rule, severity and location (FR-VAL-006, FR-V3-LOG-005)"
      />
      {validate.isError && <ErrorBanner error={validate.error} />}
      {activeJob && (
        <LiveJobConsole
          projectId={projectId}
          jobId={activeJob.jobId}
          title={`Validating ${activeJob.path}`}
          onFinished={() =>
            void qc.invalidateQueries({ queryKey: qk.automation(projectId) })
          }
          onRetried={(newJobId) =>
            setActiveJob((cur) => (cur ? { ...cur, jobId: newJobId } : cur))
          }
        />
      )}
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
                        loading={validate.isPending && validate.variables?.id === a.id}
                        onClick={() => validate.mutate({ id: a.id, path: a.path })}
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
