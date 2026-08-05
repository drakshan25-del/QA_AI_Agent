/**
 * Live UI-scan log console (FR-UIS-004).
 *
 * Five colour-coded levels, level filtering, search, auto-scroll with a pause
 * that engages automatically when the user scrolls up, plus clear, copy and
 * download. Nothing sensitive can appear here: every line was redacted before
 * it was persisted or broadcast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import type { UiScanLogLevel } from '../../services/api/types';
import type { UiScanLogRowView } from './useUiScanStream';
import s from './uiScanner.module.css';

const LEVELS: UiScanLogLevel[] = ['debug', 'info', 'warning', 'error', 'success'];

const LEVEL_COLOR: Record<UiScanLogLevel, string> = {
  debug: 'var(--text-muted)',
  info: 'var(--info)',
  warning: 'var(--warn)',
  error: 'var(--danger)',
  success: 'var(--ok)',
};

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

/** Fixed-width plain text for copy and download. */
function toText(r: UiScanLogRowView): string {
  return `[${clock(r.ts)}] ${r.level.toUpperCase().padEnd(7)} [${r.stage}] ${r.message}`;
}

export function UiScanLogConsole({
  rows,
  connection,
  scanId,
  onClear,
}: {
  rows: UiScanLogRowView[];
  connection: string;
  scanId: string | null;
  onClear: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<Set<UiScanLogLevel>>(() => new Set(LEVELS));
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Follow-tail: pin to the newest line unless the reader has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && !pausedRef.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        levels.has(r.level) &&
        (!q ||
          r.message.toLowerCase().includes(q) ||
          r.stage.toLowerCase().includes(q)),
    );
  }, [rows, levels, query]);

  const toggleLevel = (level: UiScanLogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      // An empty filter would hide everything with no explanation.
      return next.size ? next : new Set(LEVELS);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map(toText).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — download is still available */
    }
  };

  const download = () => {
    const blob = new Blob([filtered.map(toText).join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ui-scan-${(scanId ?? 'logs').slice(0, 8)}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={s.console} aria-label="UI scan logs">
      <header className={s.consoleBar}>
        <strong style={{ fontSize: 13 }}>Scan log</strong>
        <span style={{ opacity: 0.6, fontSize: 12 }}>WS: {connection}</span>
        <input
          aria-label="Search scan logs"
          placeholder="Search logs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: 'auto', minWidth: 180 }}
        />
        <Button small variant="ghost" onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
        </Button>
        <Button small variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Button small variant="ghost" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button small variant="ghost" onClick={download}>
          Download
        </Button>
      </header>

      <div className={s.levelFilters}>
        {LEVELS.map((level) => {
          const on = levels.has(level);
          return (
            <button
              key={level}
              type="button"
              aria-pressed={on}
              onClick={() => toggleLevel(level)}
              className={`${s.levelChip} ${on ? s.levelChipOn : ''}`}
              style={{ color: LEVEL_COLOR[level], opacity: on ? 1 : 0.6 }}
            >
              {level}
            </button>
          );
        })}
      </div>

      <ol
        ref={listRef}
        className={s.logList}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (!atBottom && !pausedRef.current) setPaused(true);
          else if (atBottom && pausedRef.current) setPaused(false);
        }}
      >
        {filtered.length === 0 && (
          <li style={{ opacity: 0.6 }}>
            {rows.length === 0
              ? 'Waiting for the first log entry…'
              : 'No log lines match the current filters.'}
          </li>
        )}
        {filtered.map((r) => (
          <li key={r.seq} className={s.logRow}>
            <span className={s.logTime}>{clock(r.ts)}</span>{' '}
            <span className={s.logLevel} style={{ color: LEVEL_COLOR[r.level] }}>
              {r.level}
            </span>{' '}
            <span className={s.logStage}>[{r.stage}]</span> <span>{r.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
