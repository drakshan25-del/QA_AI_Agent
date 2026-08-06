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
import { tokenStore } from './tokenStore';
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
