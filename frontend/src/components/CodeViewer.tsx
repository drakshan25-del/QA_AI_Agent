import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useEffect, useState } from 'react';

/** Infer a Prism language from a file path. */
function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'py':
      return 'python';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'md':
      return 'markdown';
    default:
      return 'text';
  }
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return dark;
}

/**
 * Syntax-highlighted, read-only code viewer (FR-AUT-009). Content is passed as
 * a plain string to the highlighter which tokenises it as text — it is never
 * injected as HTML, so generated code is safe to display (FR-FE-006, SEC-004).
 */
export function CodeViewer({
  path,
  content,
  language,
}: {
  path?: string;
  content: string;
  language?: string;
}): JSX.Element {
  const dark = usePrefersDark();
  const lang = language ?? (path ? languageForPath(path) : 'text');
  return (
    <SyntaxHighlighter
      language={lang}
      style={dark ? oneDark : oneLight}
      showLineNumbers
      wrapLongLines
      customStyle={{
        margin: 0,
        borderRadius: 8,
        fontSize: 13,
        maxHeight: '65vh',
      }}
    >
      {content || '// (empty)'}
    </SyntaxHighlighter>
  );
}
