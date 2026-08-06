import s from './ui.module.css';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'running';

const toneClass: Record<Tone, string> = {
  ok: s.b_ok,
  warn: s.b_warn,
  danger: s.b_danger,
  info: s.b_info,
  neutral: s.b_neutral,
  running: s.b_running,
};

/**
 * Maps any workflow/approval/execution status string to an accessible badge
 * with a semantic tone (FR-FE-003). The running tone pulses so an in-progress
 * state is visible without relying on colour alone (label is always present).
 */
const STATUS_TONE: Record<string, Tone> = {
  // job / execution lifecycle
  idle: 'neutral',
  loading: 'info',
  queued: 'info',
  pending: 'warn',
  running: 'running',
  in_progress: 'running',
  completed: 'ok',
  passed: 'ok',
  approved: 'ok',
  success: 'ok',
  failed: 'danger',
  error: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
  skipped: 'neutral',
  regenerate: 'warn',
  superseded: 'neutral',
  active: 'ok',
  archived: 'neutral',
  // validation
  none: 'neutral',
  generated: 'info',
  validated: 'ok',
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status.toLowerCase()] ?? 'neutral';
}

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}): JSX.Element {
  const tone = statusTone(status);
  const text = (label ?? status).replace(/_/g, ' ');
  const isRunning = tone === 'running';
  return (
    <span className={`${s.badge} ${toneClass[tone]}`} aria-label={`Status: ${text}`}>
      <span className={`${s.dot} ${isRunning ? s.pulse : ''}`} aria-hidden="true" />
      {text}
    </span>
  );
}
