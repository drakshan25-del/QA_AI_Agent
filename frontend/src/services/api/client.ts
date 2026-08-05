/**
 * Axios API client (V2_CONTRACT §2). Responsibilities:
 *  - baseURL from VITE_API_BASE, cookies enabled (refresh cookie, FR-FE-004)
 *  - attaches the Bearer access token to every request
 *  - generates an `x-correlation-id` per request (FR-BE-003) unless supplied
 *  - transparently refreshes the access token once on a 401 and replays the
 *    original request; concurrent 401s share a single in-flight refresh
 *  - normalises the backend error envelope `{ error: {...} }` (FR-BE-001)
 */
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { config } from './config';
import { expiryOf, tokenStore } from './tokenStore';
import type { ApiError } from './types';

/** Error surfaced to the UI — always carries a machine code + message. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(e: ApiError, status?: number) {
    super(e.message);
    this.name = 'ApiClientError';
    this.code = e.code;
    this.status = status;
    this.details = e.details;
    this.correlationId = e.correlationId;
  }
}

function newCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const http: AxiosInstance = axios.create({
  baseURL: config.apiBase,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(cfg.headers);
  const token = tokenStore.get();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('x-correlation-id')) {
    headers.set('x-correlation-id', newCorrelationId());
  }
  cfg.headers = headers;
  return cfg;
});

// ---- single-flight refresh on 401 ------------------------------------------

let refreshPromise: Promise<string | null> | null = null;

/** Hook the AuthContext installs to be told when the session is truly gone. */
let onAuthLost: (() => void) | null = null;
export function setOnAuthLost(fn: (() => void) | null): void {
  onAuthLost = fn;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>(
        `${config.apiBase}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((r) => {
        tokenStore.set(r.data.accessToken);
        return r.data.accessToken;
      })
      .catch(() => {
        tokenStore.clear();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// ---- proactive refresh ------------------------------------------------------
// Without this the ONLY refresh trigger is a 401 that has already failed, so
// every access-token lifetime produced one rejected request — and one rejected
// WebSocket handshake, which has no response interceptor to retry it.

/** Refresh once this fraction of the token's remaining lifetime has elapsed. */
const REFRESH_AT = 0.8;
/** Floor on the scheduled delay, so clock skew cannot cause a tight loop. */
const MIN_REFRESH_DELAY_MS = 5_000;
/** Treat a token expiring within this window as already unusable. */
const NEAR_EXPIRY_MS = 30_000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Arm a timer to refresh at {@link REFRESH_AT} of the token's remaining life,
 * replacing it before the backend would reject it. Re-armed automatically on
 * every token change, since a successful refresh writes back to the store.
 */
function scheduleProactiveRefresh(token: string | null): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!token) return; // logged out: nothing to keep alive
  const expiresAt = expiryOf(token);
  if (expiresAt === null) return; // unreadable exp: reactive refresh still covers it
  const delay = Math.max(MIN_REFRESH_DELAY_MS, (expiresAt - Date.now()) * REFRESH_AT);
  refreshTimer = setTimeout(() => {
    void refreshAccessToken();
  }, delay);
}

tokenStore.subscribe(scheduleProactiveRefresh);

/**
 * A token safe to open a *new* connection with — refreshed first when it is
 * missing, expired, or within {@link NEAR_EXPIRY_MS} of expiring.
 *
 * The WebSocket handshake cannot be replayed by the response interceptor, so
 * it must never present a token the gateway will reject (FR-BE-002).
 */
export async function ensureFreshToken(): Promise<string | null> {
  const token = tokenStore.get();
  const expiresAt = expiryOf(token);
  if (token && (expiresAt === null || expiresAt - Date.now() > NEAR_EXPIRY_MS)) {
    return token;
  }
  return refreshAccessToken();
}

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
  url?: string;
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ error?: ApiError }>) => {
    const original = error.config as (RetriableConfig & InternalAxiosRequestConfig) | undefined;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        const headers = AxiosHeaders.from(original.headers);
        headers.set('Authorization', `Bearer ${token}`);
        original.headers = headers;
        return http.request(original);
      }
      onAuthLost?.();
    }

    const envelope = error.response?.data?.error;
    const apiError: ApiError = envelope ?? {
      code: error.code ?? 'network_error',
      message: error.message || 'Network error — the backend may be unreachable.',
    };
    return Promise.reject(new ApiClientError(apiError, status));
  },
);
