import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';

/** Infer a Prism grammar from a file path (mirrors CodeViewer). */
function prismLangForPath(path?: string): { grammar: Prism.Grammar; name: string } {
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'python',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
  };
  const name = map[ext] ?? 'clike';
  return { grammar: Prism.languages[name] ?? Prism.languages.clike, name };
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
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
 * Editable, syntax-highlighted code editor (AC-001/AC-002). A textarea overlays
 * a Prism-highlighted layer, so typing/delete/copy/cut/paste all work while the
 * code stays coloured; line numbers are rendered in a gutter. Content is only
 * ever tokenised by Prism — never injected as HTML — so edited/generated code
 * is safe to render (FR-FE-006, SEC-004).
 */
export function CodeEditor({
  value,
  onChange,
  path,
  readOnly = false,
  minHeight = '55vh',
}: {
  value: string;
  onChange: (next: string) => void;
  path?: string;
  readOnly?: boolean;
  minHeight?: string;
}): JSX.Element {
  const dark = usePrefersDark();
  const { grammar, name } = useMemo(() => prismLangForPath(path), [path]);
  const preRef = useRef<HTMLPreElement | null>(null);

  const lineCount = useMemo(() => Math.max(value.split('\n').length, 1), [value]);
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount],
  );

  const colors = dark
    ? { bg: '#0d1117', fg: '#c9d1d9', gutter: '#484f58', border: '#30363d' }
    : { bg: '#fbfbfb', fg: '#24292e', gutter: '#b0b7c0', border: '#d0d7de' };

  return (
    <div
      className={`code-editor code-editor-${dark ? 'dark' : 'light'}`}
      style={{
        display: 'flex',
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        background: colors.bg,
        maxHeight: '70vh',
        overflow: 'auto',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <pre
        aria-hidden="true"
        ref={preRef}
        style={{
          margin: 0,
          padding: '12px 8px 12px 12px',
          textAlign: 'right',
          color: colors.gutter,
          userSelect: 'none',
          whiteSpace: 'pre',
          minWidth: `${String(lineCount).length + 1}ch`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {gutter}
      </pre>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Editor
          value={value}
          onValueChange={readOnly ? () => undefined : onChange}
          readOnly={readOnly}
          highlight={(code) => Prism.highlight(code, grammar, name)}
          padding={12}
          textareaClassName="code-editor-textarea"
          aria-label={path ? `Code editor for ${path}` : 'Code editor'}
          spellCheck={false}
          style={{
            minHeight,
            color: colors.fg,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}
