import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorBanner } from '../components/ui/Banner';
import { ReportView } from '../features/reports/ReportView';
import { executionsApi } from '../services/api/endpoints';
import { ApiClientError } from '../services/api/client';
import { qk } from '../services/api/queryKeys';
import L from '../styles/layout.module.css';

export function ExecutionReportPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const runQuery = useQuery({
    queryKey: qk.execution(id),
    queryFn: () => executionsApi.get(id),
    enabled: !!id,
  });
  const reportQuery = useQuery({
    queryKey: qk.executionReport(id),
    queryFn: () => executionsApi.report(id),
    enabled: !!id,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => executionsApi.generateReport(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.executionReport(id) }),
  });

  const notGenerated =
    reportQuery.isError &&
    reportQuery.error instanceof ApiClientError &&
    reportQuery.error.status === 404;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Execution report"
        subtitle={<span className={L.mono}>run {id.slice(0, 8)}</span>}
        actions={
          <Link to={`/executions/${id}`}>
            <Button variant="ghost">Back to timeline</Button>
          </Link>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}

      {reportQuery.isLoading && <FullPageSpinner label="Loading report…" />}

      {notGenerated && (
        <EmptyState
          title="No report generated yet"
          action={
            <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
              Generate report
            </Button>
          }
        >
          Build a report from this run's results, metrics and evidence (FR-REP-004).
        </EmptyState>
      )}

      {reportQuery.isError && !notGenerated && <ErrorBanner error={reportQuery.error} />}

      {reportQuery.data && (
        <ReportView runId={id} report={reportQuery.data} run={runQuery.data} />
      )}

      {!reportQuery.isLoading && !reportQuery.data && !notGenerated && !reportQuery.isError && (
        <Card>
          <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
            Generate report
          </Button>
        </Card>
      )}
    </div>
  );
}
