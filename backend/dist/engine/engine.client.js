"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var EngineClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineClient = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
const correlation_1 = require("../common/correlation");
const errors_1 = require("../common/errors");
const redact_1 = require("../common/redact");
let EngineClient = EngineClient_1 = class EngineClient {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(EngineClient_1.name);
        const engine = this.config.get('engine');
        this.baseUrl = engine.url.replace(/\/$/, '');
        this.token = engine.token;
        this.http = axios_1.default.create({
            baseURL: `${this.baseUrl}/internal/v1`,
            timeout: engine.timeoutMs,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    headers(correlationId, idempotencyKey) {
        const h = { 'X-Engine-Token': this.token };
        if (correlationId)
            h[correlation_1.CORRELATION_HEADER] = correlationId;
        if (idempotencyKey)
            h['Idempotency-Key'] = idempotencyKey;
        return h;
    }
    async post(path, body, correlationId, idempotencyKey) {
        const maxAttempts = 3;
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const res = await this.http.post(path, body, {
                    headers: this.headers(correlationId, idempotencyKey),
                });
                return res.data;
            }
            catch (err) {
                lastErr = err;
                if (attempt === maxAttempts || !isTransient(err))
                    break;
                const delayMs = 1000 * 2 ** (attempt - 1);
                this.logger.warn(`POST ${path} transient failure (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`);
                await sleep(delayMs);
            }
        }
        throw this.wrap(lastErr, `POST ${path}`);
    }
    wrap(err, ctx) {
        const ax = err;
        const detail = ax.response?.data ?? {
            message: ax.message,
        };
        const reason = typeof detail.detail === 'string' ? ` — ${detail.detail}` : '';
        this.logger.error(`${ctx} failed: ${ax.message}${reason}`, undefined);
        return new errors_1.EngineException(`Engine call failed (${ctx}): ${ax.message}${reason}`, (0, redact_1.redact)(detail));
    }
    async health() {
        const res = await this.http.get('/health', { headers: this.headers() });
        return res.data;
    }
    async parse(files, correlationId) {
        return this.post('/parse', { files }, correlationId);
    }
    async analyse(body, correlationId, idempotencyKey) {
        return this.post('/analyse', body, correlationId, idempotencyKey);
    }
    async testPlan(body, correlationId, idempotencyKey) {
        return this.post('/test-plan', body, correlationId, idempotencyKey);
    }
    async testCases(body, correlationId, idempotencyKey) {
        return this.post('/test-cases', body, correlationId, idempotencyKey);
    }
    async automation(body, correlationId, idempotencyKey) {
        return this.post('/automation', body, correlationId, idempotencyKey);
    }
    async validate(body, correlationId) {
        return this.post('/validate', body, correlationId);
    }
    async executionPlan(body, correlationId) {
        return this.post('/execution-plan', body, correlationId);
    }
    async classify(body, correlationId) {
        return this.post('/classify', body, correlationId);
    }
    async report(body, correlationId) {
        return this.post('/report', body, correlationId);
    }
    async execute(body, correlationId, idempotencyKey) {
        return this.post('/execute', body, correlationId, idempotencyKey);
    }
    async renderPdf(html, correlationId) {
        return this.post('/render-pdf', { html }, correlationId);
    }
    async cancelExecution(runId, correlationId) {
        return this.post(`/executions/${encodeURIComponent(runId)}/cancel`, {}, correlationId);
    }
    async streamRunEvents(runId, onEvent, opts = {}) {
        const url = `/runs/${encodeURIComponent(runId)}/events`;
        const res = await this.http.get(url, {
            params: { from_seq: opts.fromSeq ?? 0 },
            headers: this.headers(opts.correlationId),
            responseType: 'stream',
            signal: opts.signal,
            timeout: 0,
        });
        const stream = res.data;
        let buffer = '';
        await new Promise((resolve, reject) => {
            const onData = (chunk) => {
                buffer += chunk.toString('utf8');
                let idx;
                while ((idx = buffer.indexOf('\n\n')) !== -1) {
                    const frame = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);
                    const parsed = parseSseFrame(frame);
                    if (parsed)
                        void onEvent(parsed);
                }
            };
            stream.on('data', onData);
            stream.on('end', () => resolve());
            stream.on('error', (e) => reject(e));
            if (opts.signal) {
                opts.signal.addEventListener('abort', () => {
                    stream.destroy();
                    resolve();
                });
            }
        });
    }
};
exports.EngineClient = EngineClient;
exports.EngineClient = EngineClient = EngineClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EngineClient);
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isTransient(err) {
    const ax = err;
    if (!ax.response)
        return true;
    return [502, 503, 504].includes(ax.response.status);
}
function parseSseFrame(frame) {
    let seq = 0;
    let type = 'message';
    const dataLines = [];
    for (const raw of frame.split('\n')) {
        const line = raw.trimEnd();
        if (!line || line.startsWith(':'))
            continue;
        if (line.startsWith('id:'))
            seq = parseInt(line.slice(3).trim(), 10) || 0;
        else if (line.startsWith('event:'))
            type = line.slice(6).trim();
        else if (line.startsWith('data:'))
            dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length)
        return null;
    let payload = {};
    try {
        payload = JSON.parse(dataLines.join('\n'));
    }
    catch {
        payload = { raw: dataLines.join('\n') };
    }
    return { seq, type, payload };
}
//# sourceMappingURL=engine.client.js.map