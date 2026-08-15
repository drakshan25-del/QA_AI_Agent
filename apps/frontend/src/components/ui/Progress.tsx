import s from './ui.module.css';

export function Progress({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={s.progress}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}
