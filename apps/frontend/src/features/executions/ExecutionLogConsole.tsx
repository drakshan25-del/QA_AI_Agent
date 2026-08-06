/**
 * Real-time execution log console (§ live execution logs) — a Jenkins/GitHub
 * Actions-style viewer for one run. Mirrors the LiveJobConsole pattern:
 *
 * - Persisted lines are replayed via GET /executions/:id/logs on mount and on
 *   socket reconnect, deduplicated by `seq`, so a refresh/reconnect resumes
 *   without duplicates.
 * - Live lines arrive as `execution.log` envelopes on the run stream.
 *
 * Beyond the job console it adds: seven colour-coded levels, level filtering,
 * text search, copy-to-clipboard, download-as-.txt, and pause/resume of the
 * follow-tail auto-scroll.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executionsApi } from '../../services/api/endpoints';
import { useSocket } from '../../hooks/useSocket';
import type {
  EventEnvelope,
  ExecutionLogLevel,
  ExecutionLogPayload,
} from '../../services/api/types';
import { Button } from '../../components/ui/Button';
import { Progress } from '../../components/ui/Progress';

interface LogRow {
  seq: number;
  level: ExecutionLogLevel;
  stage: string;
  message: string;
  progress: number | null;
  testCaseId?: string;
  testName?: string;
  meta?: Record<string, unknown> | null;
  ts: string;
}

const LEVELS: ExecutionLogLevel[] = [
  'debug',
  'info',
  'warning',
  'error',
  'success',
  'pass',
  'fail',
];

/** Each level has its own colour (requirement: colour-coded levels). */
const LEVEL_COLOR: Record<ExecutionLogLevel, string> = {
  debug: 'var(--text-dim, #8b949e)',
  info: 'var(--accent, #58a6ff)',
  warning: 'var(--warn, #d29922)',
  error: 'var(--danger, #f85149)',
  success: 'var(--ok, #2ea043)',
  pass: 'var(--ok, #2ea043)',
  fail: 'var(--danger, #f85149)',
};

function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

/** Fixed-width, plain-text rendering of one row for copy/download. */
function toText(r: LogRow): string {
  const clock = formatClock(r.ts);
  const level = r.level.toUpperCase().padEnd(7);
  const stage = r.stage ? `[${r.stage}] ` : '';
  return `[${clock}] ${level} ${stage}${r.message}`;
}

export function ExecutionLogConsole({
  runId,
  projectId,
  live,
}: {
  runId: string;
  projectId: string | undefined;
  live: boolean;
}): JSX.Element {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<Set<ExecutionLogLevel>>(
    () => new Set(LEVELS),
  );
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const listRef = useRef<HTMLOListElement | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const lastSeqRef = useRef(0);

  // Dedup against prev itself so StrictMode double-invocation and reconnect
  // replays can never introduce duplicates.
  const appendRows = useCallback((incoming: LogRow[]) => {
    if (!incoming.length) return;
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.seq));
      const fresh = incoming.filter((r) => !have.has(r.seq));
      if (!fresh.length) return prev;
      const next = [...prev, ...fresh].sort((a, b) => a.seq - b.seq);
      lastSeqRef.current = next[next.length - 1]!.seq;
      return next;
    });
  }, []);

  const replay = useCallback(
    async (fromSeq: number) => {
      try {
        const logs = await executionsApi.logs(runId, fromSeq);
        appendRows(
          logs.map((l) => ({
            seq: l.seq,
            level: l.level,
            stage: l.stage,
            message: l.message,
            progress: l.progress,
            testCaseId: l.testCaseId,
            testName: l.testName,
            meta: l.meta,
            // Persisted rows carry `createdAt`; the live payload carries `ts`.
            ts: l.createdAt,
          })),
        );
      } catch {
        // Replay is best-effort; live events still arrive.
      }
    },
    [runId, appendRows],
  );

  // Seed once per run; the live stream + reconnect handle the rest.
  useEffect(() => {
    setRows([]);
    lastSeqRef.current = 0;
    void replay(0);
  }, [runId, replay]);

  // Follow-tail: pin to newest unless paused (explicitly or by scrolling up).
  useEffect(() => {
    const el = listRef.current;
    if (el && !pausedRef.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const onEvent = useCallback(
    (envelope: EventEnvelope) => {
      if (envelope.type !== 'execution.log') return;
      if (envelope.runId && envelope.runId !== runId) return;
      const p = envelope.payload as unknown as ExecutionLogPayload;
      appendRows([
        {
          seq: p.seq,
          level: p.level,
          stage: p.stage,
          message: p.message,
          progress: p.progress,
          testCaseId: p.testCaseId,
          testName: p.testName,
          meta: p.meta ?? null,
          ts: p.ts,
        },
      ]);
    },
    [runId, appendRows],
  );

  const { status: connection } = useSocket({
    projectId,
    runId,
    enabled: live && !!projectId,
    onEvent,
    onReconnect: () => void replay(lastSeqRef.current),
  });

  const toggleLevel = (lvl: ExecutionLogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      // Never allow an empty filter (that would hide everything silently).
      return next.size ? next : new Set(LEVELS);
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        levels.has(r.level) &&
        (!q ||
          r.message.toLowerCase().includes(q) ||
          r.stage.toLowerCase().includes(q) ||
          (r.testName ?? '').toLowerCase().includes(q)),
    );
  }, [rows, levels, query]);

  const stage = rows.length ? rows[rows.length - 1]!.stage : '';
  const progress = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const p = rows[i]!.progress;
      if (p !== null && p !== undefined) return p;
    }
    return 0;
  }, [rows]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map(toText).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — download remains available */
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([filtered.map(toText).join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-${runId.slice(0, 8)}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Execution logs"
      style={{
        border: '1px solid var(--border, #30363d)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, #30363d)',
          flexWrap: 'wrap',
        }}
      >
        {stage && (
          <span style={{ opacity: 0.85 }}>
            stage: <strong>{stage}</strong>
          </span>
        )}
        <span style={{ opacity: 0.6, fontSize: 12 }}>WS: {connection}</span>
        <input
          aria-label="Search logs"
          placeholder="Search logs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: 'auto', minWidth: 180 }}
        />
        <Button small variant="ghost" onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume autoscroll' : 'Pause autoscroll'}
        </Button>
        <Button small variant="ghost" onClick={copyLogs}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button small variant="ghost" onClick={downloadLogs}>
          Download .txt
        </Button>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border, #30363d)',
        }}
      >
        {LEVELS.map((lvl) => {
          const on = levels.has(lvl);
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => toggleLevel(lvl)}
              aria-pressed={on}
              style={{
                cursor: 'pointer',
                border: `1px solid ${LEVEL_COLOR[lvl]}`,
                background: on ? LEVEL_COLOR[lvl] : 'transparent',
                color: on ? '#0d1117' : LEVEL_COLOR[lvl],
                borderRadius: 999,
                fontSize: 10,
                textTransform: 'uppercase',
                padding: '1px 8px',
                opacity: on ? 1 : 0.6,
              }}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      {(progress > 0 || live) && (
        <div style={{ padding: '6px 12px' }}>
          <Progress value={progress} />
        </div>
      )}

      <ol
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          // Scrolling up pauses the follow-tail; returning to the bottom resumes.
          if (!atBottom && !pausedRef.current) setPaused(true);
          else if (atBottom && pausedRef.current) setPaused(false);
        }}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '6px 12px 12px',
          maxHeight: 380,
          overflowY: 'auto',
          fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, monospace)',
          fontSize: 12,
          lineHeight: 1.7,
          background: 'var(--bg-code, #0d1117)',
        }}
      >
        {filtered.length === 0 && (
          <li style={{ opacity: 0.6 }}>
            {rows.length === 0
              ? 'Waiting for the first log entry…'
              : 'No log lines match the current filters.'}
          </li>
        )}
        {filtered.map((r) => {
          const hasMeta = !!r.meta && Object.keys(r.meta).length > 0;
          return (
            <li key={r.seq} style={{ whiteSpace: 'pre-wrap' }}>
              <span style={{ opacity: 0.5 }}>{formatClock(r.ts)}</span>{' '}
              <span
                style={{
                  color: LEVEL_COLOR[r.level] ?? LEVEL_COLOR.info,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {r.level.padEnd(5)}
              </span>{' '}
              {r.stage && (
                <em style={{ opacity: 0.7 }}>[{r.stage}]</em>
              )}{' '}
              <span>{r.message}</span>
              {hasMeta && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((cur) => (cur === r.seq ? null : r.seq))
                    }
                    aria-expanded={expanded === r.seq}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent, #58a6ff)',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: 0,
                    }}
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
          );
        })}
      </ol>
    </section>
  );
}
