import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { Timeline, EvidencePanel } from '../features/executions/Timeline';
import { useExecutionEvents } from '../features/executions/useExecutionEvents';
import { executionsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import { formatDuration, formatRelative } from '../lib/format';
import s from '../features/executions/execution.module.css';
import L from '../styles/layout.module.css';

const ACTIVE = new Set(['queued', 'running']);

export function ExecutionLivePage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const runQuery = useQuery({
    queryKey: qk.execution(id),
    queryFn: () => executionsApi.get(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE.has(status) ? 4000 : false;
    },
  });

  const run = runQuery.data;
  const isActive = run ? ACTIVE.has(run.status) : true;

  const { state, connection } = useExecutionEvents(id, run?.projectId, {
    live: isActive,
    ...(run ? { initialStatus: run.status } : {}),
  });

  const cancel = useMutation({
    mutationFn: () => executionsApi.cancel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.execution(id) }),
  });

  const passed = state.steps.filter((st) => st.status === 'passed').length;
  const failed = state.steps.filter((st) => st.status === 'failed').length;
  const total = state.steps.length;
  const runStatus = run?.status ?? state.runStatus;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Execution"
        subtitle={
          <span className={L.mono}>
            run {id.slice(0, 8)} · WS: {connection}
            {!isActive ? ' · replay' : ''}
          </span>
        }
        actions={
          <div className={L.row}>
            <StatusBadge status={runStatus} />
            {isActive && (
              <Button
                variant="danger"
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Cancel run
              </Button>
            )}
            <Link to={`/executions/${id}/report`}>
              <Button variant="primary">View report</Button>
            </Link>
          </div>
        }
      />

      {cancel.isError && <ErrorBanner error={cancel.error} />}
      {!isActive && total > 0 && (
        <Banner kind="info">Replaying the recorded timeline for this completed run (FR-EXE-010).</Banner>
      )}

      <Card title="Live status">
        <div className={s.liveStats}>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Current test</div>
            <div className={s.liveValue}>{state.currentTestName || '—'}</div>
          </div>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Current URL</div>
            <div className={s.liveValue}>{state.currentUrl || '—'}</div>
          </div>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Elapsed</div>
            <div className={s.liveValue}>{formatDuration(state.elapsedMs)}</div>
          </div>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Progress</div>
            <div className={s.liveValue}>
              {passed} passed · {failed} failed · {total} steps
            </div>
          </div>
          {run && (
            <div className={s.liveStat}>
              <div className={s.liveLabel}>Environment</div>
              <div className={s.liveValue}>
                {run.browser} · {run.environment}
                {run.headed ? ' · headed' : ''}
              </div>
            </div>
          )}
          {run?.startedAt && (
            <div className={s.liveStat}>
              <div className={s.liveLabel}>Started</div>
              <div className={s.liveValue}>{formatRelative(run.startedAt)}</div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Timeline" subtitle="Ordered actions with plain-language labels (FR-EXE-006/007)">
        <Timeline state={state} />
      </Card>

      <Card title="Evidence" subtitle="Screenshots and artefacts (secrets masked, FR-EXE-008)">
        <QueryState query={runQuery} loadingLabel="Loading run…">
          {(r) => <EvidencePanel evidence={r.evidence} />}
        </QueryState>
      </Card>
    </div>
  );
}
