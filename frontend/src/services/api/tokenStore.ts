/**
 * In-memory access-token holder. The 15-minute JWT access token lives only in
 * memory (never localStorage) to limit XSS blast radius; the 7-day refresh
 * token is an HTTP-only cookie the browser cannot read (V2_CONTRACT §1).
 * On hard reload the app silently re-acquires an access token via the refresh
 * cookie (`POST /auth/refresh`).
 */

type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null): void {
    accessToken = token;
    for (const l of listeners) l(token);
  },
  clear(): void {
    this.set(null);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
