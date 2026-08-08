import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Readable } from 'stream';
import { AppConfig } from '../config/configuration';
import { CORRELATION_HEADER } from '../common/correlation';
import { EngineException } from '../common/errors';
import { redact } from '../common/redact';

/** One parsed SSE event from the engine run stream. */
export interface EngineSseEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Typed client for the engine's `/internal/v1/*` contract (V2_CONTRACT §4).
 * Adds the static `X-Engine-Token` (server-side only, never exposed to the
 * browser, FR-CI-004), the `X-Correlation-Id` (FR-ENG-003) and, on job
 * submits, the `Idempotency-Key` (FR-BE-003).
 */
@Injectable()
export class EngineClient {
  private readonly logger = new Logger(EngineClient.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    const engine = this.config.get<AppConfig['engine']>('engine')!;
    this.baseUrl = engine.url.replace(/\/$/, '');
    this.token = engine.token;
    this.http = axios.create({
      baseURL: `${this.baseUrl}/internal/v1`,
      timeout: engine.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private headers(correlationId?: string, idempotencyKey?: string) {
    const h: Record<string, string> = { 'X-Engine-Token': this.token };
    if (correlationId) h[CORRELATION_HEADER] = correlationId;
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    return h;
  }

  /**
   * POST with bounded exponential backoff on transient failures
   * (FR-V3-ENT-009): network errors and 502/503/504 are retried up to 3
   * times (1s → 2s → 4s). Job submits carry an Idempotency-Key so retries
   * never duplicate side effects.
   */
  private async post<T>(
    path: string,
    body: unknown,
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<T> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.http.post<T>(path, body, {
          headers: this.headers(correlationId, idempotencyKey),
        });
        return res.data;
      } catch (err) {
        lastErr = err;
        if (attempt === maxAttempts || !isTransient(err)) break;
        const delayMs = 1000 * 2 ** (attempt - 1);
        this.logger.warn(
          `POST ${path} transient failure (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
    throw this.wrap(lastErr, `POST ${path}`);
  }

  private wrap(err: unknown, ctx: string): EngineException {
    const ax = err as AxiosError;
    const detail = (ax.response?.data as Record<string, unknown>) ?? {
      message: ax.message,
    };
    // FastAPI puts the actionable reason (e.g. "Model 'x' is not available in
    // Ollama...") in `detail`; without it the job error is just a status code.
    const reason = typeof detail.detail === 'string' ? ` — ${detail.detail}` : '';
    this.logger.error(`${ctx} failed: ${ax.message}${reason}`, undefined);
    return new EngineException(
      `Engine call failed (${ctx}): ${ax.message}${reason}`,
      redact(detail),
    );
  }

  // --- health -------------------------------------------------------------
  async health(): Promise<Record<string, unknown>> {
    const res = await this.http.get('/health', { headers: this.headers() });
    return res.data as Record<string, unknown>;
  }

  // --- document parsing (FR-IN-002/008) -----------------------------------
  async parse(
    files: { filename: string; category: string; contentBase64: string }[],
    correlationId?: string,
  ): Promise<{ documents: EngineParsedDocument[]; schema_version?: string }> {
    return this.post('/parse', { files }, correlationId);
  }

  // --- agents -------------------------------------------------------------
  async analyse(
    body: {
      requirementId?: string;
      text: string;
      acceptanceCriteria?: string[];
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/analyse', body, correlationId, idempotencyKey);
  }

  async testPlan(
    body: {
      projectName: string;
      baseUrl?: string;
      requirements?: unknown[];
      analyses?: unknown[];
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/test-plan', body, correlationId, idempotencyKey);
  }

  async testCases(
    body: {
      requirement: unknown;
      analysis?: unknown;
      minCases?: number;
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/test-cases', body, correlationId, idempotencyKey);
  }

  async automation(
    body: {
      testCases: unknown[];
      baseUrl?: string;
      pageObjectsSummary?: string;
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/automation', body, correlationId, idempotencyKey);
  }

  // --- validation / plan --------------------------------------------------
  async validate(
    body: {
      files: { path: string; content: string }[];
      allowedDomains?: string[];
      runCollection?: boolean;
    },
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/validate', body, correlationId);
  }

  async executionPlan(
    body: { testCases: unknown[]; baseUrl?: string },
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/execution-plan', body, correlationId);
  }

  // --- classification / report --------------------------------------------
  async classify(
    body: { test: unknown; context?: unknown; model?: string; temperature?: number },
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/classify', body, correlationId);
  }

  async report(
    body: { data: Record<string, unknown> },
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/report', body, correlationId);
  }

  // --- execution ----------------------------------------------------------
  async execute(
    body: {
      runId: string;
      /** Approved generated files to materialise in the engine workspace
       * before the run (path + content) — DB is the artefact store, the
       * engine filesystem is not (FR-V3-ENT-005). */
      files?: { path: string; content: string }[];
      testPaths?: string[];
      browser?: string;
      headed?: boolean;
      environment?: string;
      allowedDomains?: string;
      targetBaseUrl?: string;
      markers?: string;
      // V3 runtime settings (FR-V3-EXE-011)
      timeoutSeconds?: number;
      retries?: number;
      workers?: number;
      slowMoMs?: number;
      screenshotMode?: string;
      video?: boolean;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<{ runId: string; status: string; eventsUrl: string }> {
    return this.post('/execute', body, correlationId, idempotencyKey);
  }

  /** Render HTML to a real PDF via the engine's headless Chromium
   * (FR-REP-003/FR-V3-RPT-005). */
  async renderPdf(
    html: string,
    correlationId?: string,
  ): Promise<{ pdfBase64: string }> {
    return this.post('/render-pdf', { html }, correlationId);
  }

  async cancelExecution(
    runId: string,
    correlationId?: string,
  ): Promise<{ runId: string; cancelled: boolean }> {
    return this.post(
      `/executions/${encodeURIComponent(runId)}/cancel`,
      {},
      correlationId,
    );
  }

  /**
   * Opens the engine SSE stream `GET /internal/v1/runs/{runId}/events`, parses
   * envelopes and invokes `onEvent` for each. Resolves when the stream ends.
   * Returns nothing; caller supplies an AbortSignal to stop early.
   */
  async streamRunEvents(
    runId: string,
    onEvent: (event: EngineSseEvent) => void | Promise<void>,
    opts: { fromSeq?: number; correlationId?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    const url = `/runs/${encodeURIComponent(runId)}/events`;
    const res = await this.http.get(url, {
      params: { from_seq: opts.fromSeq ?? 0 },
      headers: this.headers(opts.correlationId),
      responseType: 'stream',
      signal: opts.signal,
      timeout: 0,
    });

    const stream = res.data as Readable;
    let buffer = '';
    // Handlers are chained so events are processed strictly in order and the
    // method only returns after the last handler settles. A fire-and-forget
    // dispatch here let the caller's finalize() run while the terminal
    // status event (which carries the run metrics) was still being applied,
    // so fully green runs could be reported as failed with empty metrics.
    let chain: Promise<void> = Promise.resolve();

    try {
      await new Promise<void>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let idx: number;
          // SSE frames are separated by a blank line.
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSseFrame(frame);
            if (parsed) {
              chain = chain
                .then(() => onEvent(parsed))
                .catch((err: Error) => {
                  this.logger.warn(
                    `run ${runId} event handler failed (seq ${parsed.seq}): ${err.message}`,
                  );
                });
            }
          }
        };
        stream.on('data', onData);
        stream.on('end', () => resolve());
        stream.on('error', (e: Error) => reject(e));
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            stream.destroy();
            resolve();
          });
        }
      });
    } finally {
      // Drain in-flight handlers before returning (every link is caught
      // above, so this await can never throw and mask a stream error).
      await chain;
    }
  }
}

export interface EngineParsedDocument {
  filename: string;
  category: string;
  kind: string;
  text?: string;
  segments: {
    page_or_sheet: string;
    row_or_section: string;
    content: string;
    metadata?: Record<string, unknown>;
    inclusion_status?: string;
  }[];
  parse_status: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient = worth retrying with backoff (FR-V3-ENT-009). */
function isTransient(err: unknown): boolean {
  const ax = err as AxiosError;
  if (!ax.response) return true; // network / connection error
  return [502, 503, 504].includes(ax.response.status);
}

function parseSseFrame(frame: string): EngineSseEvent | null {
  let seq = 0;
  let type = 'message';
  const dataLines: string[] = [];
  for (const raw of frame.split('\n')) {
    const line = raw.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('id:')) seq = parseInt(line.slice(3).trim(), 10) || 0;
    else if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    payload = { raw: dataLines.join('\n') };
  }
  return { seq, type, payload };
}
