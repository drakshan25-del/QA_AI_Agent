/**
 * Live activity console for a long-running job (FR-V3-LOG-001..010, §23.1.1).
 * Shows the operation name, current stage, determinate/indeterminate progress,
 * elapsed + last-event time, timestamped severity-coloured log entries with
 * expandable technical details, Cancel/Retry controls and the final status.
 *
 * Persisted logs are replayed via GET /jobs/{id}/logs on mount and on socket
 * reconnect, deduplicated by seq, so a refreshed browser resumes without
 * duplicate entries (FR-V3-LOG-008). Live entries arrive as `job.log`
 * envelopes on the project stream.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '../services/api/endpoints';
import type {
  EventEnvelope,
  Job,
  JobLogPayload,
  LogSeverity,
} from '../services/api/types';
import { useSocket } from '../hooks/useSocket';
import { Button, Progress, Spinner, StatusBadge } from './ui';

interface LogRow {
  seq: number;
  stage: string;
  message: string;
  severity: LogSeverity;
  progress: number | null;
  meta?: Record<string, unknown> | null;
  ts: string;
}

const TERMINAL: Job['status'][] = [
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
  'timed_out',
];

const severityColor: Record<LogSeverity, string> = {
  info: 'var(--text-dim, #8b949e)',
  success: 'var(--ok, #2ea043)',
  warning: 'var(--warn, #d29922)',
  error: 'var(--danger, #f85149)',
};

function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

function formatElapsed(ms: number): string {
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function LiveJobConsole({
  projectId,
  jobId,
  title,
  onFinished,
}: {
  projectId: string;
  jobId: string;
  title: string;
  onFinished?: (job: Job) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState<number | null>(null);
  const seenSeq = useRef(new Set<number>());
  const finishedRef = useRef(false);

  const { data: job, refetch: refetchJob } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => jobsApi.get(jobId),
    refetchInterval: (q) =>
      q.state.data && TERMINAL.includes(q.state.data.status) ? false : 5000,
  });

  const appendRows = useCallback((incoming: LogRow[]) => {
    setRows((prev) => {
      const fresh = incoming.filter((r) => !seenSeq.current.has(r.seq));
      if (!fresh.length) return prev;
      for (const r of fresh) seenSeq.current.add(r.seq);
      return [...prev, ...fresh].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const replay = useCallback(async () => {
    try {
      const logs = await jobsApi.logs(jobId);
      appendRows(
        logs.map((l) => ({
          seq: l.seq,
          stage: l.stage,
          message: l.message,
          severity: l.severity,
          progress: l.progress,
          meta: l.meta,
          ts: l.createdAt,
        })),
      );
    } catch {
      // Replay is best-effort; live events still arrive.
    }
  }, [jobId, appendRows]);

  useEffect(() => {
    seenSeq.current = new Set();
    setRows([]);
    finishedRef.current = false;
    void replay();
  }, [jobId, replay]);

  const onEvent = useCallback(
    (envelope: EventEnvelope) => {
      if (envelope.jobId !== jobId) return;
      if (envelope.type === 'job.log') {
        const p = envelope.payload as unknown as JobLogPayload;
        appendRows([
          {
            seq: p.seq,
            stage: p.stage,
            message: p.message,
            severity: p.severity,
            progress: p.progress,
            meta: p.meta ?? null,
            ts: p.ts,
          },
        ]);
      }
      if (
        ['job.completed', 'job.failed', 'job.cancelled'].includes(envelope.type)
      ) {
        void refetchJob();
      }
    },
    [jobId, appendRows, refetchJob],
  );

  useSocket({
    projectId,
    enabled: !!projectId,
    onEvent,
    onReconnect: () => void replay(),
  });

  const isRunning = !!job && !TERMINAL.includes(job.status);

  // Elapsed-time ticker while the job runs (§23.1.1).
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  useEffect(() => {
    if (job && TERMINAL.includes(job.status) && !finishedRef.current) {
      finishedRef.current = true;
      onFinished?.(job);
    }
  }, [job, onFinished]);

  const cancelMutation = useMutation({
    mutationFn: () => jobsApi.cancel(jobId),
    onSuccess: () => void refetchJob(),
  });
  const retryMutation = useMutation({
    mutationFn: () => jobsApi.retry(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', projectId, 'jobs'] });
    },
  });

  const progress = job?.progress ?? 0;
  const determinate = rows.some((r) => r.progress !== null) || progress > 0;
  const startedAt = job?.startedAt ? new Date(job.startedAt).getTime() : null;
  const finishedAt = job?.finishedAt ? new Date(job.finishedAt).getTime() : null;
  const elapsed = startedAt ? (finishedAt ?? now) - startedAt : 0;
  const lastEvent = rows.length ? rows[rows.length - 1] : null;
  const stage = job?.currentStage || lastEvent?.stage || '';

  const statusLabel = useMemo(() => {
    if (!job) return 'loading';
    return job.status;
  }, [job]);

  return (
    <section
      aria-live="polite"
      aria-label={`${title} activity console`}
      style={{
        border: '1px solid var(--border, #30363d)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 'var(--space, 16px)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border, #30363d)',
          flexWrap: 'wrap',
        }}
      >
        {isRunning && <Spinner />}
        <strong>{title}</strong>
        <StatusBadge status={statusLabel} />
        {stage && (
          <span style={{ opacity: 0.8 }}>
            stage: <strong>{stage.replace(/_/g, ' ')}</strong>
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {job?.startedAt && <>started {formatClock(job.startedAt)} · </>}
          elapsed {formatElapsed(elapsed)}
          {lastEvent?.ts && <> · last event {formatClock(lastEvent.ts)}</>}
        </span>
        {isRunning && (
          <Button
            small
            variant="ghost"
            onClick={() => cancelMutation.mutate()}
            loading={cancelMutation.isPending}
            disabled={job?.cancelRequested}
          >
            {job?.cancelRequested ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
        {job && ['failed', 'cancelled', 'timed_out'].includes(job.status) && (
          <Button
            small
            onClick={() => retryMutation.mutate()}
            loading={retryMutation.isPending}
          >
            Retry
          </Button>
        )}
      </header>

      <div style={{ padding: '8px 14px' }}>
        {determinate ? (
          <Progress value={progress} />
        ) : (
          isRunning && (
            <p style={{ margin: 0, opacity: 0.7 }}>
              <Spinner /> Working…
            </p>
          )
        )}
      </div>

      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '4px 14px 12px',
          maxHeight: 320,
          overflowY: 'auto',
          fontFamily: 'var(--mono, ui-monospace, monospace)',
          fontSize: 12,
          lineHeight: 1.7,
        }}
      >
        {rows.length === 0 && (
          <li style={{ opacity: 0.6 }}>Waiting for the first log entry…</li>
        )}
        {rows.map((r) => (
          <li key={r.seq}>
            <span style={{ opacity: 0.55 }}>{formatClock(r.ts)}</span>{' '}
            <span
              style={{
                color: severityColor[r.severity] ?? severityColor.info,
                textTransform: 'uppercase',
                fontSize: 10,
              }}
            >
              {r.severity}
            </span>{' '}
            {r.stage && <em style={{ opacity: 0.75 }}>[{r.stage}]</em>}{' '}
            <span>{r.message}</span>
            {r.meta && Object.keys(r.meta).length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((cur) => (cur === r.seq ? null : r.seq))
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent, #58a6ff)',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: 0,
                  }}
                  aria-expanded={expanded === r.seq}
                >
                  {expanded === r.seq ? 'hide details' : 'details'}
                </button>
                {expanded === r.seq && (
                  <pre
                    style={{
                      margin: '4px 0 6px 16px',
                      whiteSpace: 'pre-wrap',
                      opacity: 0.85,
                    }}
                  >
                    {JSON.stringify(r.meta, null, 2)}
                  </pre>
                )}
              </>
            )}
          </li>
        ))}
        {job?.error && (
          <li style={{ color: severityColor.error }}>{job.error}</li>
        )}
      </ol>
    </section>
  );
}
