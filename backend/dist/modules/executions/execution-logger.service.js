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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionLoggerService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const redact_1 = require("../../common/redact");
const events_service_1 = require("../events/events.service");
let ExecutionLoggerService = class ExecutionLoggerService {
    constructor(logs, events) {
        this.logs = logs;
        this.events = events;
        this.logger = new common_1.Logger('Execution');
        this.seqByRun = new Map();
        this.seeded = new Set();
        this.seeding = new Map();
    }
    forRun(ctx) {
        let stage = '';
        const svc = this;
        const emit = (level, message, extra) => svc.write(ctx, {
            level,
            stage: extra?.stage ?? stage,
            message,
            progress: extra?.progress ?? null,
            testCaseId: extra?.testCaseId,
            testName: extra?.testName,
            meta: extra?.meta,
        });
        return {
            get currentStage() {
                return stage;
            },
            setStage(next) {
                stage = next;
            },
            stage(next, message) {
                stage = next;
                return emit('info', message ?? next);
            },
            info: (m, extra) => emit('info', m, extra),
            debug: (m, extra) => emit('debug', m, extra),
            warning: (m, extra) => emit('warning', m, extra),
            error: (m, extra) => emit('error', m, extra),
            success: (m, extra) => emit('success', m, extra),
            pass: (m, extra) => emit('pass', m, extra),
            fail: (m, extra) => emit('fail', m, extra),
            progress: (current, total, message, extra) => {
                const pct = total > 0
                    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
                    : null;
                return emit('info', message, { ...extra, progress: pct });
            },
        };
    }
    async write(ctx, entry) {
        const seq = await this.nextSeq(ctx.runId);
        const level = entry.level ?? 'info';
        const stage = entry.stage ?? '';
        const message = (0, redact_1.redactText)(entry.message || '');
        const meta = entry.meta
            ? (0, redact_1.redact)(entry.meta)
            : null;
        const progress = entry.progress === null || entry.progress === undefined
            ? null
            : Math.max(0, Math.min(100, Math.round(entry.progress)));
        const ts = new Date().toISOString();
        try {
            await this.logs.save(this.logs.create({
                executionRunId: ctx.runId,
                projectId: ctx.projectId,
                seq,
                stage,
                level,
                message,
                progress,
                testCaseId: entry.testCaseId ?? '',
                testName: entry.testName ?? '',
                meta,
            }));
        }
        catch (err) {
            this.logger.warn(`execution log persist failed (run ${ctx.runId}): ${err.message}`);
        }
        this.events.emit({
            type: 'execution.log',
            projectId: ctx.projectId,
            runId: ctx.runId,
            correlationId: ctx.correlationId,
            payload: {
                runId: ctx.runId,
                seq,
                level,
                stage,
                message,
                progress,
                testCaseId: entry.testCaseId ?? '',
                testName: entry.testName ?? '',
                meta: meta ?? undefined,
                ts,
            },
        });
        const line = `[${ctx.runId.slice(0, 8)}]${stage ? ` [${stage}]` : ''} ${message}`;
        if (level === 'error' || level === 'fail')
            this.logger.error(line);
        else if (level === 'warning')
            this.logger.warn(line);
        else if (level === 'debug')
            this.logger.debug(line);
        else
            this.logger.log(line);
    }
    async fetch(runId, fromSeq = 0) {
        return this.logs.find({
            where: { executionRunId: runId, ...(fromSeq ? { seq: (0, typeorm_2.MoreThan)(fromSeq) } : {}) },
            order: { seq: 'ASC' },
            take: 5000,
        });
    }
    release(runId) {
        this.seqByRun.delete(runId);
        this.seeded.delete(runId);
        this.seeding.delete(runId);
    }
    async nextSeq(runId) {
        if (!this.seeded.has(runId)) {
            let pending = this.seeding.get(runId);
            if (!pending) {
                pending = (async () => {
                    try {
                        const last = await this.logs.findOne({
                            where: { executionRunId: runId },
                            order: { seq: 'DESC' },
                            select: { seq: true },
                        });
                        const base = last?.seq ?? 0;
                        if ((this.seqByRun.get(runId) ?? 0) < base) {
                            this.seqByRun.set(runId, base);
                        }
                    }
                    finally {
                        this.seeded.add(runId);
                        this.seeding.delete(runId);
                    }
                })();
                this.seeding.set(runId, pending);
            }
            await pending;
        }
        const next = (this.seqByRun.get(runId) ?? 0) + 1;
        this.seqByRun.set(runId, next);
        return next;
    }
};
exports.ExecutionLoggerService = ExecutionLoggerService;
exports.ExecutionLoggerService = ExecutionLoggerService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ExecutionLogEntry)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        events_service_1.EventsService])
], ExecutionLoggerService);
//# sourceMappingURL=execution-logger.service.js.map