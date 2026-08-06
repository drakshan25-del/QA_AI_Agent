import { createHash } from 'crypto';

/** Stable SHA-256 content hash for artefact provenance (§5, FR-VAL-007). */
export function contentHash(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return createHash('sha256').update(value).digest('hex');
  }
  const canonical =
    typeof value === 'string' ? value : stableStringify(value);
  return createHash('sha256').update(canonical).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}
