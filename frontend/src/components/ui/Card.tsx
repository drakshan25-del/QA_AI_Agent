import type { ReactNode } from 'react';
import s from './ui.module.css';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  noPad?: boolean;
  className?: string;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  noPad,
  className,
}: CardProps): JSX.Element {
  return (
    <section className={`${s.card} ${noPad ? s.cardPad0 : ''} ${className ?? ''}`}>
      {(title || actions) && (
        <header className={s.cardHeader} style={noPad ? { padding: 'var(--space)', marginBottom: 0 } : undefined}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {subtitle && <p className={s.cardSub}>{subtitle}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
