import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LinkButton } from '../components/ui/LinkButton';
import { Select } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import {
  Timeline,
  EvidencePanel,
  type TimelineFilter,
} from '../features/executions/Timeline';
import { useExecutionEvents } from '../features/executions/useExecutionEvents';
import { executionsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import { formatDuration, formatRelative } from '../lib/format';
import s from '../features/executions/execution.module.css';
import L from '../styles/layout.module.css';

/** Non-terminal run states (§23.7 execution state machine). */
const ACTIVE = new Set(['queued', 'preparing', 'running', 'stopping']);

const BROWSER_LABEL: Record<string, string> = {
  chromium: 'Chrome (Chromium engine)',
  firefox: 'Firefox',
  webkit: 'Safari (WebKit engine)',
};

export function ExecutionLivePage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TimelineFilter>({});

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

  const stop = useMutation({
    mutationFn: () => executionsApi.cancel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.execution(id) }),
  });
  const restart = useMutation({
    mutationFn: () => executionsApi.restart(id),
    onSuccess: (res) => navigate(`/executions/${res.id}`),
  });

  const passed = state.steps.filter((st) => st.status === 'passed').length;
  const failed = state.steps.filter((st) => st.status === 'failed').length;
  const total = state.steps.length;
  const runStatus = run?.status ?? state.runStatus;
  const lastStep = state.steps.length ? state.steps[state.steps.length - 1] : null;
  const settings = (run?.settings ?? {}) as Record<string, unknown>;

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
                loading={stop.isPending}
                onClick={() => stop.mutate()}
              >
                Stop
              </Button>
            )}
            {!isActive && (
              <Button
                loading={restart.isPending}
                onClick={() => restart.mutate()}
                title="Start a new traceable run with the same configuration (FR-V3-EXE-008)"
              >
                Restart
              </Button>
            )}
            <LinkButton variant="primary" to={`/executions/${id}/report`}>
              View report
            </LinkButton>
          </div>
        }
      />

      {stop.isError && <ErrorBanner error={stop.error} />}
      {restart.isError && <ErrorBanner error={restart.error} />}
      {runStatus === 'queued' && (
        <Banner kind="info">
          This run is queued behind other executions (FR-V3-EXE-012); it starts
          automatically when a slot frees up.
        </Banner>
      )}
      {!isActive && total > 0 && (
        <Banner kind="info">Replaying the recorded timeline for this completed run (FR-EXE-010).</Banner>
      )}

      <Card title="Live status" subtitle="Current test, step, URL, browser, mode, progress and elapsed time (FR-V3-EXE-006)">
        <div className={s.liveStats}>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Current test</div>
            <div className={s.liveValue}>{state.currentTestName || '—'}</div>
          </div>
          <div className={s.liveStat}>
            <div className={s.liveLabel}>Current step</div>
            <div className={s.liveValue}>
              {lastStep ? `#${lastStep.sequence} ${lastStep.actionType}` : '—'}
            </div>
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
              <div className={s.liveLabel}>Browser · mode</div>
              <div className={s.liveValue}>
                {BROWSER_LABEL[run.browser] ?? run.browser} ·{' '}
                {run.headed ? 'headed' : 'headless'}
              </div>
            </div>
          )}
          {run && (
            <div className={s.liveStat}>
              <div className={s.liveLabel}>Scope · environment</div>
              <div className={s.liveValue}>
                {run.runScope || 'selected'} · {run.environment}
                {run.mode === 'ci' ? ' · CI' : ' · local'}
              </div>
            </div>
          )}
          {Object.keys(settings).length > 0 && (
            <div className={s.liveStat}>
              <div className={s.liveLabel}>Settings</div>
              <div className={s.liveValue}>
                timeout {String(settings.timeoutSeconds ?? '—')}s · retries{' '}
                {String(settings.retries ?? 0)} · workers{' '}
                {String(settings.workers ?? 1)}
                {Number(settings.slowMoMs ?? 0) > 0
                  ? ` · slow-mo ${String(settings.slowMoMs)}ms`
                  : ''}
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
        {run?.headed && run.mode === 'local' && (
          <Banner kind="info">
            Headed mode: the browser window opens on the execution host running
            the QA engine, not inside this web page (FR-V3-EXE-014).
          </Banner>
        )}
      </Card>

      <Card
        title="Timeline"
        subtitle="Ordered actions with plain-language labels (FR-EXE-006/007, §23.3.2)"
        actions={
          <div className={L.row}>
            <input
              aria-label="Filter steps"
              placeholder="Filter by test, target, action…"
              value={filter.query ?? ''}
              onChange={(e) =>
                setFilter((f) => ({ ...f, query: e.target.value || undefined }))
              }
            />
            <Select
              label="Status"
              value={filter.status ?? ''}
              onChange={(e) =>
                setFilter((f) => ({ ...f, status: e.target.value || undefined }))
              }
            >
              <option value="">All statuses</option>
              {['running', 'passed', 'failed', 'skipped'].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <Timeline state={state} filter={filter} />
      </Card>

      <Card title="Evidence" subtitle="Screenshots and artefacts (secrets masked, FR-EXE-008)">
        <QueryState query={runQuery} loadingLabel="Loading run…">
          {(r) => <EvidencePanel evidence={r.evidence} />}
        </QueryState>
      </Card>
    </div>
  );
}
