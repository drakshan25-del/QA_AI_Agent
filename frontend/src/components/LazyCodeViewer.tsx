import { lazy, Suspense } from 'react';
import { Spinner } from './ui/Spinner';

// react-syntax-highlighter is heavy, so it is loaded on demand (only the
// automation page needs it) to keep the initial bundle lean.
const CodeViewer = lazy(() =>
  import('./CodeViewer').then((m) => ({ default: m.CodeViewer })),
);

export function LazyCodeViewer(props: {
  path?: string;
  content: string;
  language?: string;
}): JSX.Element {
  return (
    <Suspense fallback={<Spinner label="Loading code viewer…" />}>
      <CodeViewer {...props} />
    </Suspense>
  );
}
