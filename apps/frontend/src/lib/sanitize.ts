/**
 * Content-safety helpers (FR-FE-006, SEC-004). Uploaded and AI-generated
 * content is untrusted. We NEVER use dangerouslySetInnerHTML with it — React's
 * JSX text interpolation escapes by default, so rendering values as {text} is
 * inherently safe. These helpers normalise arbitrary/unknown values into plain
 * strings for display and defang anything that could execute if a value ever
 * reaches an attribute (e.g. links).
 */

/** Coerce any value into a display string without executing it. */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Only allow http(s)/mailto links; everything else (javascript:, data:) → '#'. */
export function safeHref(href: string | undefined | null): string {
  if (!href) return '#';
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  return '#';
}
