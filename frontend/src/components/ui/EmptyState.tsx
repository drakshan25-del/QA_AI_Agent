import type { ReactNode } from 'react';
import s from './ui.module.css';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className={s.empty}>
      <div className={s.emptyTitle}>{title}</div>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
