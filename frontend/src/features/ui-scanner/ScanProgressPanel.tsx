/**
 * Scan progress panel (FR-UIS-003).
 *
 * Shows the stage the backend is actually in, its determinate progress, the
 * elapsed time and the live counters. Every number here comes from a
 * `ui_scan.status` envelope or the persisted scan row — nothing is simulated
 * on the client.
 */
import { useEffect, useState } from 'react';
import { Progress } from '../../components/ui/Progress';
import { Spinner } from '../../components/ui/Spinner';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { UI_SCAN_STAGE_LABELS, UI_SCAN_TERMINAL_STAGES } from '../../services/api/types';
import type { UiScan, UiScanStage } from '../../services/api/types';
import type { UiScanLiveState } from './useUiScanStream';
import s from './uiScanner.module.css';

function formatElapsed(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Terminal stages map to the app's existing badge tones. */
function stageTone(stage: UiScanStage): string {
  if (stage === 'COMPLETED') return 'completed';
  if (stage === 'FAILED') return 'failed';
  if (stage === 'CANCELLED') return 'cancelled';
  if (stage === 'IDLE') return 'idle';
  return 'running';
}

export function ScanProgressPanel({
  scan,
  live,
}: {
  scan: UiScan | null;
  live: UiScanLiveState;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  // Live counters prefer the stream (it is ahead of the persisted row while a
  // scan runs) and fall back to the record once it has been saved.
  const stage: UiScanStage = live.stage !== 'IDLE' ? live.stage : (scan?.status ?? 'IDLE');
  const running = !UI_SCAN_TERMINAL_STAGES.includes(stage) && stage !== 'IDLE';
  const progress = live.progress || scan?.progress || 0;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startedIso = live.startedAt ?? scan?.startedAt ?? null;
  const startedAt = startedIso ? new Date(startedIso).getTime() : null;
  const finishedAt = scan?.completedAt ? new Date(scan.completedAt).getTime() : null;
  const elapsed = startedAt ? (running ? now : (finishedAt ?? now)) - startedAt : 0;

  const counters = [
    { label: 'Elements found', value: live.totalElements || scan?.totalElements || 0 },
    {
      label: 'Validated locators',
      value: live.validLocatorCount || scan?.validLocatorCount || 0,
    },
    { label: 'Unresolved', value: live.unresolvedCount || scan?.unresolvedCount || 0 },
    { label: 'Pages scanned', value: live.pageCount || scan?.pageCount || 0 },
    { label: 'Frames scanned', value: live.frameCount || scan?.frameCount || 0 },
    { label: 'Warnings', value: live.warningCount || scan?.warningCount || 0 },
    { label: 'Errors', value: live.errorCount || scan?.errorCount || 0 },
  ];

  return (
    <div aria-live="polite">
      <div className={s.stageRow}>
        {running && <Spinner label="Scan in progress" />}
        <span className={s.stageName}>{UI_SCAN_STAGE_LABELS[stage]}</span>
        <StatusBadge status={stageTone(stage)} label={stage.replace(/_/g, ' ')} />
        {live.message && <span className={s.stageMeta}>{live.message}</span>}
        <span className={s.stageMeta} style={{ marginLeft: 'auto' }}>
          {startedIso && <>started {new Date(startedIso).toLocaleTimeString()} · </>}
          elapsed {formatElapsed(elapsed)}
          {scan?.durationMs != null && !running && (
            <> · duration {(scan.durationMs / 1000).toFixed(1)}s</>
          )}
        </span>
      </div>

      <Progress value={progress} />

      <div className={s.counters}>
        {counters.map((c) => (
          <div key={c.label} className={s.counter}>
            <div className={s.counterValue}>{c.value}</div>
            <div className={s.counterLabel}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
