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
    // A timeout has no response body at all, so name the knob that fixes it.
    const reason =
      typeof detail.detail === 'string'
        ? ` — ${detail.detail}`
        : ax.code === 'ECONNABORTED' || ax.code === 'ETIMEDOUT'
          ? ' — the model did not respond in time; raise ENGINE_TIMEOUT_MS or choose a faster model'
          : '';
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
      /** Approved locators from the UI Scanner; the agent must use these
       * instead of inventing selectors (FR-UIS-025). */
      approvedLocators?: unknown[];
      /**
       * Per-step locators already resolved against the scanner's library
       * (FR-UIS-025 §8). This — not raw HTML, not "write a selector" — is what
       * binds a generated Playwright line to a validated locator.
       */
      resolvedSteps?: unknown[];
      /** Steps no validated locator was found for; the agent must emit a
       * note for each instead of inventing one; nothing is blocked. */
      unresolvedSteps?: unknown[];
      /** Emit `# UI Scanner Locator: <id>-v<n>` comments (§14). */
      locatorComments?: boolean;
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.post('/automation', body, correlationId, idempotencyKey);
  }

  /**
   * Ask the model to match test steps to elements the scanner already found
   * (FR-UIS-025 §2.5).
   *
   * The request carries compact element *metadata* and the response may only
   * name a locator id that was offered — the model has no way to introduce a
   * selector of its own through this call, and the caller discards anything
   * that is not in the offered set.
   */
  async matchLocators(
    body: {
      steps: {
        testStepId: string;
        description: string;
        action: string;
        pageName?: string;
        parentContext?: string;
      }[];
      elements: Record<string, unknown>[];
      model?: string;
      temperature?: number;
    },
    correlationId?: string,
  ): Promise<{ matches: { testStepId: string; locatorId: string; confidence?: number }[] }> {
    return this.post('/locators/match', body, correlationId);
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

  // --- UI scanner (FR-UIS-*) ----------------------------------------------

  /**
   * Start a UI scan. The engine owns the browser; the backend owns the scan
   * record and supplies its id, so events and the collected result correlate
   * without a second identifier.
   *
   * `username`/`password`/`storageState` are forwarded for a single sign-in
   * and are never persisted by either tier (§16) — which is also why this
   * call is deliberately *not* retried: a replay would resubmit credentials.
   */
  async startUiScan(
    body: UiScanRequest,
    correlationId?: string,
  ): Promise<{ scanId: string; status: string; eventsUrl: string }> {
    try {
      const res = await this.http.post<{
        scanId: string;
        status: string;
        eventsUrl: string;
      }>('/ui-scans', body, { headers: this.headers(correlationId) });
      return res.data;
    } catch (err) {
      throw this.wrap(err, 'POST /ui-scans');
    }
  }

  async cancelUiScan(
    scanId: string,
    correlationId?: string,
  ): Promise<{ scanId: string; cancelled: boolean }> {
    try {
      const res = await this.http.post<{ scanId: string; cancelled: boolean }>(
        `/ui-scans/${encodeURIComponent(scanId)}/cancel`,
        {},
        { headers: this.headers(correlationId) },
      );
      return res.data;
    } catch (err) {
      throw this.wrap(err, `POST /ui-scans/${scanId}/cancel`);
    }
  }

  /**
   * Collect a finished scan's result. The screenshot and ARIA snapshot travel
   * here rather than through the event stream, which stays small and ordered.
   */
  async getUiScanResult(
    scanId: string,
    correlationId?: string,
  ): Promise<UiScanResult> {
    const res = await this.http.get<UiScanResult>(
      `/ui-scans/${encodeURIComponent(scanId)}/result`,
      {
        headers: this.headers(correlationId),
        // A full-page screenshot plus a few hundred elements is well past
        // axios' 10MB default body cap.
        maxContentLength: 64 * 1024 * 1024,
        maxBodyLength: 64 * 1024 * 1024,
      },
    );
    return res.data;
  }

  /**
   * Re-validate stored locators against the live page. Synchronous and
   * short-lived — it powers "Test locator" and "Revalidate", where the verdict
   * must come from the application rather than from a remembered result.
   */
  async validateUiLocators(
    body: ValidateLocatorsRequest,
    correlationId?: string,
  ): Promise<{ results: EngineLocatorVerdict[] }> {
    try {
      const res = await this.http.post<{ results: EngineLocatorVerdict[] }>(
        '/ui-scans/validate-locators',
        body,
        { headers: this.headers(correlationId) },
      );
      return res.data;
    } catch (err) {
      throw this.wrap(err, 'POST /ui-scans/validate-locators');
    }
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

    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        // SSE frames are separated by a blank line.
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSseFrame(frame);
          if (parsed) void onEvent(parsed);
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
  }
}

/** Body of `POST /internal/v1/ui-scans` (V2_CONTRACT §4, FR-UIS-*). */
export interface UiScanRequest {
  scanId: string;
  url: string;
  browser: string;
  headless: boolean;
  timeoutMs: number;
  maxElements: number;
  maxPages: number;
  includeHidden: boolean;
  captureScreenshot: boolean;
  captureAccessibility: boolean;
  scanFrames: boolean;
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
  preScanActions?: Record<string, unknown>[];
  loginUrl?: string;
  /** Single-use sign-in credentials — forwarded, never stored (§16). */
  username?: string;
  password?: string;
  /** Opaque Playwright storage state; never logged or returned (§16). */
  storageState?: Record<string, unknown>;
  model: string;
  temperature: number;
  useLlmFallback: boolean;
  correlationId?: string;
}

/** Body of `POST /internal/v1/ui-scans/validate-locators`. */
export interface ValidateLocatorsRequest {
  url: string;
  browser: string;
  headless: boolean;
  timeoutMs: number;
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
  loginUrl?: string;
  username?: string;
  password?: string;
  storageState?: Record<string, unknown>;
  locators: { id: string; locatorData: Record<string, unknown> }[];
}

/** Verdict for one re-validated locator. */
export interface EngineLocatorVerdict {
  id: string;
  matchCount: number;
  unique: boolean;
  valid: boolean;
  visible: boolean;
  enabled: boolean;
  error?: string;
}

/** One locator candidate as returned by the engine. */
export interface EngineLocatorCandidate {
  id: string;
  strategy: string;
  expression: string;
  pythonExpression: string;
  locatorData: Record<string, unknown>;
  baseScore: number;
  finalScore: number;
  confidence: number;
  matchCount: number;
  unique: boolean;
  valid: boolean;
  reasons: string[];
  warnings: string[];
  source: string;
  [k: string]: unknown;
}

/** One scanned element as returned by the engine. */
export interface EngineScannedElement {
  elementKey: string;
  uid: string;
  tagName: string;
  inferredRole: string;
  explicitRole: string;
  accessibleName: string;
  accessibleNameSource: string;
  visibleText: string;
  inputType: string;
  name: string;
  id: string;
  placeholder: string;
  title: string;
  alt: string;
  href: string;
  value: string;
  testIds: Record<string, string>;
  classes: string[];
  ariaLabel: string;
  ariaLabelledBy: string;
  ariaDescribedBy: string;
  ariaDescription: string;
  sensitive: boolean;
  states: Record<string, boolean>;
  position: Record<string, number>;
  context: Record<string, unknown>;
  frame: Record<string, unknown>;
  candidates: EngineLocatorCandidate[];
  recommendedLocatorId: string;
  status: string;
  pageUrl: string;
  pageTitle: string;
}

/** Body of `GET /internal/v1/ui-scans/:scanId/result`. */
export interface UiScanResult {
  schema_version?: string;
  status: 'COMPLETED' | 'CANCELLED' | 'FAILED';
  url: string;
  finalUrl: string;
  pageTitle: string;
  browser: string;
  headless: boolean;
  elements: EngineScannedElement[];
  frames: Record<string, unknown>[];
  metrics: Record<string, unknown>;
  warnings: string[];
  errors?: string[];
  error?: {
    code: string;
    message: string;
    stage: string;
    recoverable: boolean;
  };
  accessibilitySnapshot: string;
  screenshotBase64: string;
  selectedModel: string;
  durationMs: number;
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

/** Transient = worth retrying with backoff (FR-V3-ENT-009).
 *
 * A client-side timeout is deliberately NOT transient. The engine runs
 * generation synchronously and does not cancel on client disconnect, so when
 * `ENGINE_TIMEOUT_MS` fires the work is still running on Ollama. Retrying
 * starts a *second* generation competing for the same GPU — three attempts
 * against a slow reasoning model (deepseek-r1) means ~30 minutes of load that
 * cannot succeed. Raise `ENGINE_TIMEOUT_MS` instead.
 */
function isTransient(err: unknown): boolean {
  const ax = err as AxiosError;
  // axios reports timeouts as ECONNABORTED, or ETIMEDOUT when
  // `transitional.clarifyTimeoutError` is enabled.
  if (ax.code === 'ECONNABORTED' || ax.code === 'ETIMEDOUT') return false;
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
