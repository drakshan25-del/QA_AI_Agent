import type { ReactNode } from 'react';
import L from '../styles/layout.module.css';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className={L.pageHeader}>
      <div>
        <h1 className={L.pageTitle}>{title}</h1>
        {subtitle && <p className={L.pageSub}>{subtitle}</p>}
      </div>
      {actions && <div className={L.headerActions}>{actions}</div>}
    </div>
  );
}
