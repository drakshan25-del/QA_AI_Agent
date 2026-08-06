import s from './ui.module.css';

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <span
      className={s.spinner}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    />
  );
}

export function FullPageSpinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className={s.fullpage}>
      <Spinner />
      <span>{label ?? 'Loading…'}</span>
    </div>
  );
}
