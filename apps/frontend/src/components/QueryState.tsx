import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { FullPageSpinner } from './ui/Spinner';
import { ErrorBanner } from './ui/Banner';

/**
 * Renders the loading/error/success states of a react-query result uniformly
 * (FR-FE-003 loading/queued/running/completed/failed; FR-FE-005 meaningful
 * errors). Keeps every page's data-fetching boilerplate to one line.
 */
export function QueryState<T>({
  query,
  children,
  loadingLabel,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}): JSX.Element {
  if (query.isLoading) return <FullPageSpinner label={loadingLabel ?? 'Loading…'} />;
  if (query.isError) return <ErrorBanner error={query.error} />;
  if (query.data === undefined) return <FullPageSpinner label={loadingLabel ?? 'Loading…'} />;
  return <>{children(query.data)}</>;
}
