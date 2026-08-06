/**
 * Secret redaction for logs and error payloads (SEC-007).
 * Recursively masks values whose key looks sensitive.
 */
const SECRET_KEY_HINTS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'auth',
  'credential',
  'apikey',
  'api_key',
  'cookie',
];

const MASK = '***';

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const low = k.toLowerCase();
      if (SECRET_KEY_HINTS.some((h) => low.includes(h))) {
        out[k] = MASK;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}

/** Redact a free-text blob by masking anything after a sensitive label. */
export function redactText(text: string): string {
  if (!text) return text;
  return text.replace(
    /(password|passwd|pwd|secret|token|credential)([=:\s]+)(\S+)/gi,
    (_m, label: string, sep: string) => `${label}${sep}${MASK}`,
  );
}
