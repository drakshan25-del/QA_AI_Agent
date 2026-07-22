import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { LiveJobConsole } from '../components/LiveJobConsole';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LinkButton } from '../components/ui/LinkButton';
import { FullPageSpinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { ReportView } from '../features/reports/ReportView';
import { executionsApi } from '../services/api/endpoints';
import { ApiClientError } from '../services/api/client';
import { qk } from '../services/api/queryKeys';
import L from '../styles/layout.module.css';

export function ExecutionReportPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

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

  // Report generation is an async job with a live console (FR-V3-LOG-006).
  const generate = useMutation({
    mutationFn: () => executionsApi.generateReport(id),
    onSuccess: (data) => setActiveJobId(data.jobId),
  });
  const publish = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      executionsApi.approveReport(id, decision),
  });

  const notGenerated =
    reportQuery.isError &&
    reportQuery.error instanceof ApiClientError &&
    reportQuery.error.status === 404;

  const projectId = runQuery.data?.projectId ?? '';

  return (
    <div className={L.stack}>
      <PageHeader
        title="Execution report"
        subtitle={<span className={L.mono}>run {id.slice(0, 8)}</span>}
        actions={
          <LinkButton variant="ghost" to={`/executions/${id}`}>
            Back to timeline
          </LinkButton>
        }
      />

      {generate.isError && <ErrorBanner error={generate.error} />}

      {activeJobId && projectId && (
        <LiveJobConsole
          projectId={projectId}
          jobId={activeJobId}
          onRetried={setActiveJobId}
          title="Generating execution report"
          onFinished={() =>
            void qc.invalidateQueries({ queryKey: qk.executionReport(id) })
          }
        />
      )}

      {reportQuery.isLoading && <FullPageSpinner label="Loading report…" />}

      {notGenerated && !activeJobId && (
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
        <>
          <Card
            title="Publication gate (FR-V3-ENT-002)"
            subtitle="Approve the report before exporting or sharing it"
          >
            <div className={L.row}>
              <Button
                small
                variant="primary"
                loading={publish.isPending}
                onClick={() => publish.mutate('approved')}
              >
                Approve for publication
              </Button>
              <Button
                small
                variant="danger"
                loading={publish.isPending}
                onClick={() => publish.mutate('rejected')}
              >
                Reject publication
              </Button>
              <Button
                small
                variant="ghost"
                loading={generate.isPending}
                onClick={() => generate.mutate()}
              >
                Regenerate report
              </Button>
            </div>
            {publish.isError && <ErrorBanner error={publish.error} />}
            {publish.isSuccess && (
              <Banner kind={publish.variables === 'approved' ? 'success' : 'warn'}>
                Report publication {publish.variables}. Rejected reports cannot be exported.
              </Banner>
            )}
          </Card>
          <ReportView runId={id} report={reportQuery.data} run={runQuery.data} />
        </>
      )}

      {!reportQuery.isLoading && !reportQuery.data && !notGenerated && !reportQuery.isError && !activeJobId && (
        <Card>
          <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
            Generate report
          </Button>
        </Card>
      )}
    </div>
  );
}
