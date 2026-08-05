/**
 * Syntax-highlighted, copyable locator code (FR-UIS-018, FR-UIS-030).
 *
 * Locator expressions are single-line Playwright chains, so a tiny tokenizer
 * beats pulling a full highlighter into this view. The block scrolls inside
 * itself, so a long expression never makes the page scroll horizontally.
 */
import { useState } from 'react';
import s from './uiScanner.module.css';

/** Split into method names, string literals and punctuation. */
const TOKEN_RE = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\.[A-Za-z_][\w]*)/g;

function tokenise(code: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let index = 0;
  let key = 0;
  for (const match of code.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > index) {
      out.push(
        <span key={key++} className={s.tokPunct}>
          {code.slice(index, start)}
        </span>,
      );
    }
    if (match[1]) {
      out.push(
        <span key={key++} className={s.tokString}>
          {match[1]}
        </span>,
      );
    } else if (match[2]) {
      out.push(
        <span key={key++} className={s.tok}>
          {match[2]}
        </span>,
      );
    }
    index = start + match[0].length;
  }
  if (index < code.length) {
    out.push(
      <span key={key++} className={s.tokPunct}>
        {code.slice(index)}
      </span>,
    );
  }
  return out;
}

export function LocatorCode({
  code,
  inline,
}: {
  code: string;
  inline?: boolean;
}): JSX.Element {
  return (
    <pre className={`${s.code} ${inline ? s.codeInline : ''}`} tabIndex={0}>
      <code>{tokenise(code)}</code>
    </pre>
  );
}

/** Copy-to-clipboard with visible confirmation (FR-UIS-030). */
export function CopyButton({
  value,
  label = 'Copy',
  title,
}: {
  value: string;
  label?: string;
  title?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.rowButton}
      title={title ?? `Copy ${label.toLowerCase()}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — the code stays selectable in the block above */
        }
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
