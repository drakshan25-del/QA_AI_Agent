import { lazy, Suspense } from 'react';
import { Spinner } from './ui/Spinner';

// prismjs + the editor are only needed on the Automation page, so they load
// on demand to keep the initial bundle lean (matches the prior viewer pattern).
const CodeEditor = lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditor })),
);

export function LazyCodeEditor(props: {
  value: string;
  onChange: (next: string) => void;
  path?: string;
  readOnly?: boolean;
  minHeight?: string;
}): JSX.Element {
  return (
    <Suspense fallback={<Spinner label="Loading editor…" />}>
      <CodeEditor {...props} />
    </Suspense>
  );
}
