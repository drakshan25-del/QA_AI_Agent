import type { ReactNode } from 'react';
import s from './ui.module.css';
import { ApiClientError } from '../../services/api/client';

type Kind = 'error' | 'info' | 'success' | 'warn';

const kindClass: Record<Kind, string> = {
  error: s.ban_error,
  info: s.ban_info,
  success: s.ban_success,
  warn: s.ban_warn,
};

export function Banner({
  kind = 'info',
  title,
  children,
}: {
  kind?: Kind;
  title?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className={`${s.banner} ${kindClass[kind]}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  );
}

/** Renders a meaningful message for an API/query error (FR-FE-005). */
export function ErrorBanner({ error }: { error: unknown }): JSX.Element {
  let message = 'Something went wrong.';
  let code: string | undefined;
  let correlationId: string | undefined;
  if (error instanceof ApiClientError) {
    message = error.message;
    code = error.code;
    correlationId = error.correlationId;
  } else if (error instanceof Error) {
    message = error.message;
  }
  return (
    <Banner kind="error" title="Error">
      {message}
      {code && <span className={s.hint}> (code: {code})</span>}
      {correlationId && (
        <div className={s.hint} style={{ marginTop: 4 }}>
          Correlation ID: {correlationId}
        </div>
      )}
    </Banner>
  );
}
