/**
 * In-memory access-token holder. The 15-minute JWT access token lives only in
 * memory (never localStorage) to limit XSS blast radius; the 7-day refresh
 * token is an HTTP-only cookie the browser cannot read (V2_CONTRACT §1).
 * On hard reload the app silently re-acquires an access token via the refresh
 * cookie (`POST /auth/refresh`).
 *
 * The store also reads the token's `exp` claim and publishes changes, so the
 * API client can refresh *before* expiry (`scheduleProactiveRefresh` in
 * `client.ts`) instead of waiting for a 401 that has already failed.
 */

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

/**
 * Epoch-milliseconds of a JWT's `exp` claim, or null when it cannot be read.
 *
 * Null is the safe answer: callers fall back to the reactive 401 refresh, so
 * an opaque or malformed token degrades rather than breaks.
 */
export function expiryOf(token: string | null): number | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const exp = (JSON.parse(atob(padded)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null): void {
    accessToken = token;
    listeners.forEach((fn) => fn(token));
  },
  clear(): void {
    this.set(null);
  },
  /** Expiry of the current token in epoch ms, or null when unknown. */
  expiresAt(): number | null {
    return expiryOf(accessToken);
  },
  /** Observe token changes. Returns an unsubscribe function. */
  subscribe(fn: (token: string | null) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
