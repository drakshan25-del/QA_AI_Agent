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
var JobsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsService = exports.JobCancelledError = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const state_machines_1 = require("../../common/state-machines");
const redact_1 = require("../../common/redact");
const errors_1 = require("../../common/errors");
const events_service_1 = require("../events/events.service");
const notifications_service_1 = require("../notifications/notifications.service");
const membership_service_1 = require("../../common/access/membership.service");
class JobCancelledError extends Error {
    constructor() {
        super('Job cancelled by user request');
    }
}
exports.JobCancelledError = JobCancelledError;
let JobsService = JobsService_1 = class JobsService {
    constructor(repo, logs, events, notifications, config, membership) {
        this.repo = repo;
        this.logs = logs;
        this.events = events;
        this.notifications = notifications;
        this.config = config;
        this.membership = membership;
        this.logger = new common_1.Logger(JobsService_1.name);
        this.logSeq = new Map();
        this.retryHandlers = new Map();
    }
    registerRetryHandler(type, handler) {
        this.retryHandlers.set(type, handler);
    }
    async create(input) {
        if (input.idempotencyKey) {
            const existing = await this.repo.findOne({
                where: {
                    projectId: input.projectId,
                    idempotencyKey: input.idempotencyKey,
                },
            });
            if (existing)
                return existing;
        }
        const job = this.repo.create({
            projectId: input.projectId,
            type: input.type,
            status: 'queued',
            progress: 0,
            correlationId: input.correlationId || '',
            idempotencyKey: input.idempotencyKey ?? null,
            inputRefs: input.inputRefs ?? null,
            createdBy: input.createdBy ?? null,
            retryOfJobId: input.retryOfJobId ?? null,
        });
        return this.repo.save(job);
    }
    dispatch(job, worker) {
        void this.execute(job, worker);
    }
    async log(job, entry) {
        const seq = (this.logSeq.get(job.id) ?? 0) + 1;
        this.logSeq.set(job.id, seq);
        const message = (0, redact_1.redactText)(entry.message || '');
        const stage = entry.stage || job.currentStage || '';
        const severity = entry.severity || 'info';
        const meta = entry.meta ? (0, redact_1.redact)(entry.meta) : null;
        try {
            await this.logs.save(this.logs.create({
                jobId: job.id,
                projectId: job.projectId,
                seq,
                stage,
                message,
                severity,
                progress: entry.progress ?? null,
                meta,
            }));
            if (entry.stage || entry.progress !== undefined) {
                job.currentStage = stage;
                if (entry.progress !== undefined) {
                    job.progress = Math.max(0, Math.min(100, Math.round(entry.progress)));
                }
                await this.repo.save(job);
            }
        }
        catch (err) {
            this.logger.warn(`job log persist failed: ${err.message}`);
        }
        this.events.emit({
            type: 'job.log',
            projectId: job.projectId,
            jobId: job.id,
            correlationId: job.correlationId,
            payload: {
                jobId: job.id,
                type: job.type,
                seq,
                stage,
                message,
                severity,
                progress: entry.progress ?? null,
                meta: meta ?? undefined,
                ts: new Date().toISOString(),
            },
        });
    }
    context(job, abort) {
        const isCancelled = async () => {
            if (abort?.current)
                return true;
            const fresh = await this.repo.findOne({
                where: { id: job.id },
                select: { id: true, cancelRequested: true },
            });
            return !!fresh?.cancelRequested;
        };
        return {
            log: (entry) => {
                if (abort?.current)
                    throw new JobCancelledError();
                return this.log(job, entry);
            },
            isCancelled,
            checkpoint: async () => {
                if (await isCancelled())
                    throw new JobCancelledError();
            },
        };
    }
    async setStatus(job, to) {
        (0, state_machines_1.assertTransition)(state_machines_1.JOB_TRANSITIONS, 'job', job.status, to);
        job.status = to;
        await this.repo.save(job);
    }
    async execute(job, worker) {
        await this.setStatus(job, 'running');
        job.startedAt = new Date();
        job.progress = 5;
        await this.repo.save(job);
        this.events.emit({
            type: 'job.progress',
            projectId: job.projectId,
            jobId: job.id,
            correlationId: job.correlationId,
            payload: { jobId: job.id, type: job.type, status: 'running', progress: 5 },
        });
        await this.log(job, {
            stage: 'started',
            message: `${labelForType(job.type)} started`,
            progress: 5,
        });
        const timeoutMs = this.config.get('jobs')?.timeoutMs ?? 1_800_000;
        let settled = false;
        const timeout = new Promise((_, reject) => {
            const t = setTimeout(() => reject(new JobTimeoutError(timeoutMs)), timeoutMs);
            if (typeof t.unref === 'function')
                t.unref();
        });
        const abort = { current: false };
        const workerPromise = worker(job, this.context(job, abort));
        workerPromise.catch(() => undefined);
        try {
            const result = await Promise.race([workerPromise, timeout]);
            settled = true;
            const hasWarnings = (result.warnings ?? []).length > 0;
            job.finishedAt = new Date();
            job.resultRefs = result.resultRefs;
            job.progress = 100;
            await this.setStatus(job, hasWarnings ? 'completed_with_warnings' : 'completed');
            await this.log(job, {
                stage: 'completed',
                severity: hasWarnings ? 'warning' : 'success',
                message: hasWarnings
                    ? `${labelForType(job.type)} completed with warnings: ${result.warnings.join('; ')}`
                    : `${labelForType(job.type)} completed`,
                progress: 100,
            });
            this.events.emit({
                type: 'job.completed',
                projectId: job.projectId,
                jobId: job.id,
                correlationId: job.correlationId,
                payload: {
                    jobId: job.id,
                    type: job.type,
                    status: job.status,
                    resultRefs: result.resultRefs,
                    warnings: result.warnings ?? [],
                },
            });
            if (result.readyEvent) {
                this.events.emit({
                    type: result.readyEvent.type,
                    projectId: job.projectId,
                    jobId: job.id,
                    correlationId: job.correlationId,
                    payload: result.readyEvent.payload,
                });
            }
            await this.notifyFinished(job, 'success');
        }
        catch (err) {
            if (settled)
                return;
            settled = true;
            abort.current = true;
            if (err instanceof JobCancelledError) {
                job.finishedAt = new Date();
                await this.setStatus(job, 'cancelled');
                await this.log(job, {
                    stage: 'cancelled',
                    severity: 'warning',
                    message: `${labelForType(job.type)} cancelled by user`,
                });
                this.events.emit({
                    type: 'job.cancelled',
                    projectId: job.projectId,
                    jobId: job.id,
                    correlationId: job.correlationId,
                    payload: { jobId: job.id, type: job.type },
                });
                return;
            }
            const timedOut = err instanceof JobTimeoutError;
            const message = (0, redact_1.redactText)(err.message || 'job failed');
            this.logger.error(`job ${job.id} (${job.type}) failed: ${message}`);
            job.finishedAt = new Date();
            job.error = message;
            await this.setStatus(job, timedOut ? 'timed_out' : 'failed');
            await this.log(job, {
                stage: timedOut ? 'timed_out' : 'failed',
                severity: 'error',
                message,
            });
            this.events.emit({
                type: 'job.failed',
                projectId: job.projectId,
                jobId: job.id,
                correlationId: job.correlationId,
                payload: { jobId: job.id, type: job.type, status: job.status, error: message },
            });
            await this.notifyFinished(job, 'failure');
        }
        finally {
            this.logSeq.delete(job.id);
        }
    }
    async notifyFinished(job, outcome) {
        if (!job.createdBy)
            return;
        const label = labelForType(job.type);
        await this.notifications.notify({
            userId: job.createdBy,
            projectId: job.projectId,
            type: outcome === 'success' ? 'job.completed' : 'job.failed',
            title: outcome === 'success'
                ? `${label} finished (${job.status.replace(/_/g, ' ')})`
                : `${label} ${job.status === 'timed_out' ? 'timed out' : 'failed'}`,
            message: outcome === 'success' ? '' : job.error,
            resourceType: 'job',
            resourceId: job.id,
            correlationId: job.correlationId,
        });
        if (outcome === 'success' &&
            ['test_plan', 'test_cases', 'automation'].includes(job.type)) {
            await this.notifications.notify({
                userId: job.createdBy,
                projectId: job.projectId,
                type: 'approval.requested',
                title: `${label} output is ready for review and approval`,
                resourceType: 'job',
                resourceId: job.id,
                correlationId: job.correlationId,
            });
        }
    }
    async get(id, user) {
        const job = await this.repo.findOne({ where: { id } });
        if (!job)
            throw new errors_1.NotFoundAppException(`Job ${id} not found`);
        if (user)
            await this.membership.ensureMember(job.projectId, user);
        return job;
    }
    async listByProject(projectId) {
        return this.repo.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
    async getLogs(id, fromSeq = 0, user) {
        await this.get(id, user);
        return this.logs.find({
            where: { jobId: id, ...(fromSeq ? { seq: (0, typeorm_2.MoreThan)(fromSeq) } : {}) },
            order: { seq: 'ASC' },
            take: 2000,
        });
    }
    async cancel(id, user) {
        const job = await this.get(id, user);
        if ((0, state_machines_1.isTerminalJobStatus)(job.status)) {
            throw new errors_1.ConflictAppException(`Job ${id} is already ${job.status} and cannot be cancelled.`, 'invalid_state_transition', { status: job.status });
        }
        job.cancelRequested = true;
        await this.repo.save(job);
        await this.log(job, {
            stage: 'cancelling',
            severity: 'warning',
            message: `Cancellation requested by ${user.email}; the job stops at the next checkpoint.`,
        });
        if (job.status === 'queued') {
            job.finishedAt = new Date();
            await this.setStatus(job, 'cancelled');
            this.events.emit({
                type: 'job.cancelled',
                projectId: job.projectId,
                jobId: job.id,
                correlationId: job.correlationId,
                payload: { jobId: job.id, type: job.type },
            });
        }
        return this.get(id);
    }
    async retry(id, user, correlationId) {
        const job = await this.get(id, user);
        if (!(0, state_machines_1.isTerminalJobStatus)(job.status)) {
            throw new errors_1.ConflictAppException(`Job ${id} is still ${job.status}; only finished jobs can be retried.`, 'invalid_state_transition', { status: job.status });
        }
        const handler = this.retryHandlers.get(job.type);
        if (!handler) {
            throw new errors_1.ConflictAppException(`Job type ${job.type} does not support retry.`, 'retry_unsupported');
        }
        const accepted = await handler(job, user, correlationId);
        await this.repo.update({ id: accepted.jobId }, { retryOfJobId: job.id });
        return { ...accepted, retryOfJobId: job.id };
    }
};
exports.JobsService = JobsService;
exports.JobsService = JobsService = JobsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Job)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.JobLogEntry)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        events_service_1.EventsService,
        notifications_service_1.NotificationsService,
        config_1.ConfigService,
        membership_service_1.MembershipService])
], JobsService);
class JobTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Job exceeded the ${Math.round(timeoutMs / 60000)} minute limit and was timed out.`);
    }
}
function labelForType(type) {
    switch (type) {
        case 'analysis':
            return 'Requirement analysis';
        case 'test_plan':
            return 'Test plan generation';
        case 'test_cases':
            return 'Test case generation';
        case 'automation':
            return 'Automation code generation';
        case 'validation':
            return 'Automation validation';
        case 'report':
            return 'Report generation';
        default:
            return 'Job';
    }
}
//# sourceMappingURL=jobs.service.js.map