import { useMemo } from 'react';
import styles from './diff.module.css';

type LineKind = 'add' | 'del' | 'meta' | 'hunk' | 'ctx';

interface DiffLine {
  kind: LineKind;
  text: string;
}

/** Classify a single unified-diff line. */
function classify(line: string): LineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index '))
    return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

/**
 * Lightweight unified-diff renderer (FR-AUT-009). The backend supplies the
 * artefact `diff` field as unified-diff text; we parse and colourise it here
 * (no external diff dependency). Text is rendered as escaped children only.
 */
export function DiffViewer({ diff }: { diff: string }): JSX.Element {
  const lines = useMemo<DiffLine[]>(
    () =>
      (diff || '').split('\n').map((text) => ({ kind: classify(text), text })),
    [diff],
  );

  if (!diff.trim()) {
    return <div className={styles.empty}>No diff — this is a newly generated file.</div>;
  }

  const kindClass: Record<LineKind, string> = {
    add: styles.add,
    del: styles.del,
    meta: styles.meta,
    hunk: styles.hunk,
    ctx: styles.ctx,
  };

  return (
    <pre className={styles.diff} aria-label="Unified diff">
      {lines.map((l, i) => (
        <div key={i} className={`${styles.line} ${kindClass[l.kind]}`}>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}
