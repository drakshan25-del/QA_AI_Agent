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
var ExecutionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const state_machines_1 = require("../../common/state-machines");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
const notifications_service_1 = require("../notifications/notifications.service");
const membership_service_1 = require("../../common/access/membership.service");
const engine_client_1 = require("../../engine/engine.client");
const execution_logger_service_1 = require("./execution-logger.service");
function browserLabel(b) {
    if (b === 'chromium')
        return 'Chrome (Chromium)';
    if (b === 'firefox')
        return 'Firefox';
    if (b === 'webkit')
        return 'Safari (WebKit)';
    return b || 'chromium';
}
function prettyTest(nodeId) {
    if (!nodeId)
        return 'test';
    const parts = nodeId.split('::');
    if (parts.length > 1)
        return parts.slice(1).join(' › ');
    return nodeId.split('/').pop() || nodeId;
}
let ExecutionsService = ExecutionsService_1 = class ExecutionsService {
    constructor(runs, execEvents, results, artifacts, projects, membership, audit, events, notifications, config, engine, execLog) {
        this.runs = runs;
        this.execEvents = execEvents;
        this.results = results;
        this.artifacts = artifacts;
        this.projects = projects;
        this.membership = membership;
        this.audit = audit;
        this.events = events;
        this.notifications = notifications;
        this.config = config;
        this.engine = engine;
        this.execLog = execLog;
        this.logger = new common_1.Logger(ExecutionsService_1.name);
        this.abortControllers = new Map();
        this.activeRuns = new Set();
        this.pumpChain = Promise.resolve();
        this.runLoggers = new Map();
        this.runStreams = new Map();
    }
    log(run, correlationId) {
        let l = this.runLoggers.get(run.id);
        if (!l) {
            l = this.execLog.forRun({
                runId: run.id,
                projectId: run.projectId,
                correlationId,
            });
            this.runLoggers.set(run.id, l);
        }
        return l;
    }
    forgetRun(runId) {
        this.runLoggers.delete(runId);
        this.runStreams.delete(runId);
        this.execLog.release(runId);
    }
    get limits() {
        return (this.config.get('execution') ?? {
            maxConcurrent: 1,
            maxTimeoutSeconds: 1800,
            maxRetries: 3,
            maxWorkers: 4,
            maxSlowMoMs: 2000,
        });
    }
    resolveSettings(dto) {
        const limits = this.limits;
        const req = dto ?? {};
        const problems = [];
        const timeoutSeconds = req.timeoutSeconds ?? 900;
        const retries = req.retries ?? 0;
        const workers = req.workers ?? 1;
        const slowMoMs = req.slowMoMs ?? 0;
        if (timeoutSeconds < 30 || timeoutSeconds > limits.maxTimeoutSeconds) {
            problems.push(`timeoutSeconds must be 30..${limits.maxTimeoutSeconds}`);
        }
        if (retries < 0 || retries > limits.maxRetries) {
            problems.push(`retries must be 0..${limits.maxRetries}`);
        }
        if (workers < 1 || workers > limits.maxWorkers) {
            problems.push(`workers must be 1..${limits.maxWorkers}`);
        }
        if (slowMoMs < 0 || slowMoMs > limits.maxSlowMoMs) {
            problems.push(`slowMoMs must be 0..${limits.maxSlowMoMs}`);
        }
        if (problems.length) {
            throw new errors_1.ValidationFailedException(`Execution settings out of the administrator-defined range: ${problems.join('; ')}.`, { limits });
        }
        return {
            timeoutSeconds,
            retries,
            workers,
            slowMoMs,
            screenshotMode: req.screenshotMode ?? 'on-failure',
            video: !!req.video,
        };
    }
    async resolveScope(dto) {
        const scope = dto.runScope ?? 'selected';
        let testPaths = dto.testPaths ?? [];
        let automationIds = dto.automationIds ?? [];
        if (scope === 'all') {
            const arts = await this.artifacts.find({
                where: {
                    projectId: dto.projectId,
                    status: 'active',
                    approvalStatus: 'approved',
                    validationStatus: (0, typeorm_2.In)(['passed', 'passed_with_warnings', 'overridden']),
                },
            });
            if (!arts.length) {
                throw new errors_1.ConflictAppException('Run All: no approved + validated automation exists in this project.', 'automation_not_ready');
            }
            automationIds = arts.map((a) => a.id);
            testPaths = [];
        }
        else if (scope === 'failed') {
            const lastRun = await this.runs.findOne({
                where: {
                    projectId: dto.projectId,
                    mode: 'local',
                    status: (0, typeorm_2.Not)((0, typeorm_2.In)(['queued', 'preparing', 'running', 'stopping'])),
                },
                order: { createdAt: 'DESC' },
            });
            if (!lastRun) {
                throw new errors_1.ConflictAppException('Run Failed Tests: no previous finished run exists for this project.', 'no_previous_run');
            }
            const failed = await this.results.find({
                where: { executionRunId: lastRun.id, outcome: (0, typeorm_2.In)(['failed', 'error']) },
            });
            const paths = [
                ...new Set(failed
                    .map((r) => (r.nodeId || '').split('::')[0])
                    .filter((p) => !!p)),
            ];
            if (!paths.length) {
                throw new errors_1.ConflictAppException(`Run Failed Tests: the last run (${lastRun.id}) has no failed tests.`, 'no_failed_tests');
            }
            automationIds = lastRun.automationIds ?? [];
            testPaths = paths;
        }
        if (automationIds.length) {
            const arts = await this.artifacts.find({
                where: { id: (0, typeorm_2.In)(automationIds), projectId: dto.projectId },
            });
            if (arts.length !== automationIds.length) {
                throw new errors_1.NotFoundAppException('One or more automation artifacts were not found in this project');
            }
            const blocked = arts.filter((a) => a.status !== 'active' ||
                a.approvalStatus !== 'approved' ||
                !['passed', 'passed_with_warnings', 'overridden'].includes(a.validationStatus));
            if (blocked.length) {
                throw new errors_1.ConflictAppException(`Cannot execute: ${blocked.length} automation artifact(s) are not ` +
                    `approved+validated+active. Approve and validate them first.`, 'automation_not_ready', {
                    blocked: blocked.map((a) => ({
                        id: a.id,
                        status: a.status,
                        approvalStatus: a.approvalStatus,
                        validationStatus: a.validationStatus,
                    })),
                });
            }
            if (scope !== 'failed') {
                testPaths = [
                    ...testPaths,
                    ...arts.filter((a) => a.kind !== 'page_object').map((a) => a.path),
                ];
            }
        }
        if (!testPaths.length) {
            throw new errors_1.ValidationFailedException('Nothing to execute: provide automationIds (approved+validated), testPaths, or use runScope=all.');
        }
        return { testPaths, automationIds, scope };
    }
    async create(dto, user, correlationId, idempotencyKey, restartOfRunId) {
        await this.membership.ensureMember(dto.projectId, user);
        const project = await this.projects.findOne({
            where: { id: dto.projectId },
        });
        if (!project) {
            throw new errors_1.NotFoundAppException(`Project ${dto.projectId} not found`);
        }
        const settings = this.resolveSettings(dto.settings);
        const { testPaths, automationIds, scope } = await this.resolveScope(dto);
        const run = await this.runs.save(this.runs.create({
            projectId: dto.projectId,
            mode: 'local',
            status: 'queued',
            environment: dto.environment || 'local',
            browser: dto.browser || 'chromium',
            headed: !!dto.headed,
            automationIds,
            testPaths,
            runScope: scope,
            settings: settings,
            restartOfRunId: restartOfRunId ?? null,
            correlationId: correlationId || '',
            createdBy: user.id,
        }));
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: restartOfRunId ? 'execution.restart' : 'execution.start',
            resourceType: 'execution',
            resourceId: run.id,
            projectId: dto.projectId,
            correlationId,
            metadata: {
                automationIds,
                testPaths,
                browser: run.browser,
                headed: run.headed,
                runScope: scope,
                settings: settings,
                restartOfRunId: restartOfRunId ?? null,
            },
        });
        const position = await this.queuedPosition(run.id);
        this.emitStatus(run, correlationId, { queued_position: position });
        const log = this.log(run, correlationId);
        await log.stage('Initializing', restartOfRunId
            ? `Restarting execution (new run ${run.id.slice(0, 8)}, same configuration).`
            : 'Execution request accepted.');
        await log.info(`Browser: ${browserLabel(run.browser)}`);
        await log.info(`Mode: ${run.headed ? 'Headed (visible browser)' : 'Headless'}`);
        await log.info(`Scope: ${scope} · Environment: ${run.environment}`);
        await log.info(`Test targets: ${testPaths.length} file(s).`, {
            meta: { testPaths },
        });
        await log.info(position > 1
            ? `Queued at position ${position} — waiting for an available runner slot.`
            : 'Queued — starting as soon as a runner slot is free.', { progress: 0 });
        void this.pump(correlationId, idempotencyKey);
        return {
            id: run.id,
            status: run.status,
            testPaths,
            runScope: scope,
            browser: run.browser,
            headed: run.headed,
            settings,
        };
    }
    async restart(id, user, correlationId) {
        const original = await this.getOne(id, user);
        if (!(0, state_machines_1.isTerminalExecutionStatus)(original.status)) {
            throw new errors_1.ConflictAppException(`Execution ${id} is still ${original.status}; stop it before restarting.`, 'invalid_state_transition');
        }
        const settings = (original.settings ?? {});
        return this.create({
            projectId: original.projectId,
            automationIds: original.automationIds ?? undefined,
            testPaths: original.runScope === 'selected' && !original.automationIds?.length
                ? (original.testPaths ?? undefined)
                : undefined,
            browser: original.browser,
            headed: original.headed,
            environment: original.environment,
            runScope: original.runScope || 'selected',
            settings,
        }, user, correlationId, undefined, original.id);
    }
    async queuedPosition(runId) {
        const run = await this.runs.findOne({ where: { id: runId } });
        if (!run || run.status !== 'queued')
            return 0;
        return this.runs
            .createQueryBuilder('r')
            .where('r.mode = :mode AND r.status = :status', {
            mode: 'local',
            status: 'queued',
        })
            .andWhere('r.created_at <= :created', {
            created: run.createdAt,
        })
            .getCount();
    }
    pump(correlationId, idempotencyKey) {
        this.pumpChain = this.pumpChain
            .then(() => this.pumpOnce(correlationId, idempotencyKey))
            .catch((err) => this.logger.warn(`pump pass failed: ${err.message}`));
        return this.pumpChain;
    }
    async pumpOnce(correlationId, idempotencyKey) {
        while (this.activeRuns.size < this.limits.maxConcurrent) {
            const next = await this.runs.findOne({
                where: { status: 'queued', mode: 'local' },
                order: { createdAt: 'ASC' },
            });
            if (!next || this.activeRuns.has(next.id))
                return;
            this.activeRuns.add(next.id);
            void this.startRun(next, correlationId, idempotencyKey);
            if (this.activeRuns.size >= this.limits.maxConcurrent)
                return;
        }
    }
    emitStatus(run, correlationId, extra = {}) {
        this.events.emit({
            type: 'execution.status',
            projectId: run.projectId,
            runId: run.id,
            correlationId,
            payload: {
                run_id: run.id,
                status: run.status,
                browser: run.browser,
                headed: run.headed,
                run_scope: run.runScope,
                ...extra,
            },
        });
    }
    async setStatus(run, to, correlationId) {
        (0, state_machines_1.assertTransition)(state_machines_1.EXECUTION_TRANSITIONS, 'execution', run.status, to);
        run.status = to;
        await this.runs.save(run);
        this.emitStatus(run, correlationId);
    }
    async startRun(run, correlationId, idempotencyKey) {
        try {
            const fresh = await this.runs.findOne({ where: { id: run.id } });
            if (!fresh || fresh.status !== 'queued') {
                this.activeRuns.delete(run.id);
                return;
            }
            run = fresh;
            const project = await this.projects.findOne({
                where: { id: run.projectId },
            });
            await this.setStatus(run, 'preparing', correlationId);
            const log = this.log(run, correlationId);
            const settings0 = (run.settings ?? {});
            await log.stage('Preparing Execution', 'Starting execution…');
            await log.stage('Loading Configuration', 'Reading execution configuration…');
            await log.info(`Settings: timeout ${settings0.timeoutSeconds}s · retries ${settings0.retries} · ` +
                `workers ${settings0.workers}` +
                (settings0.slowMoMs ? ` · slow-mo ${settings0.slowMoMs}ms` : '') +
                ` · screenshots ${settings0.screenshotMode}` +
                (settings0.video ? ' · video on' : ''));
            const files = [];
            const byPath = new Map();
            const addArts = (arts) => {
                for (const a of arts) {
                    if (a.path && a.content && !byPath.has(a.path)) {
                        byPath.set(a.path, a.content);
                        files.push({ path: a.path, content: a.content });
                    }
                }
            };
            if (run.automationIds?.length) {
                addArts(await this.artifacts.find({ where: { id: (0, typeorm_2.In)(run.automationIds) } }));
            }
            addArts(await this.artifacts.find({
                where: { projectId: run.projectId, status: 'active', kind: 'page_object' },
            }));
            await log.info(`Prepared ${files.length} automation file(s) for the runner.`);
            await log.stage('Discovering Tests', 'Discovering Playwright test files…');
            await log.info(`Found ${run.testPaths?.length ?? 0} test file(s).`, {
                meta: { testPaths: run.testPaths ?? [] },
            });
            this.runStreams.set(run.id, {
                total: run.testPaths?.length ?? 0,
                completed: 0,
                started: 0,
                testStart: new Map(),
                lastError: new Map(),
                collected: false,
            });
            await log.stage('Launching Browser', `Launching ${browserLabel(run.browser)} (${run.headed ? 'headed' : 'headless'})…`);
            const settings = (run.settings ?? {});
            await this.engine.execute({
                runId: run.id,
                files,
                testPaths: run.testPaths ?? [],
                browser: run.browser,
                headed: run.headed,
                environment: run.environment,
                allowedDomains: project?.allowedDomains ?? 'localhost,127.0.0.1',
                targetBaseUrl: project?.baseUrl ?? '',
                markers: '',
                timeoutSeconds: settings.timeoutSeconds,
                retries: settings.retries,
                workers: settings.workers,
                slowMoMs: settings.slowMoMs,
                screenshotMode: settings.screenshotMode,
                video: settings.video,
            }, correlationId, idempotencyKey);
            run.startedAt = new Date();
            await this.setStatus(run, 'running', correlationId);
            await log.stage('Running Tests', 'Runner started — executing tests…');
            await this.consumeStream(run.id, run.projectId, correlationId, settings.timeoutSeconds);
        }
        catch (err) {
            this.logger.error(`run ${run.id} failed to start: ${err.message}`);
            const log = this.log(run, correlationId);
            log.setStage('Failed');
            await log.error(`Execution failed to start: ${err.message}`, {
                meta: { stack: err.stack },
            });
            const fresh = await this.runs.findOne({ where: { id: run.id } });
            if (fresh && !(0, state_machines_1.isTerminalExecutionStatus)(fresh.status)) {
                fresh.metrics = { error: err.message };
                fresh.finishedAt = new Date();
                fresh.status = 'failed';
                await this.runs.save(fresh);
                this.emitStatus(fresh, correlationId, {
                    error: err.message,
                });
            }
            this.forgetRun(run.id);
            this.activeRuns.delete(run.id);
            void this.pump(correlationId);
        }
    }
    async consumeStream(runId, projectId, correlationId, timeoutSeconds) {
        const controller = new AbortController();
        this.abortControllers.set(runId, controller);
        const testOutcomes = new Map();
        const watchdogMs = ((timeoutSeconds ?? 900) + 120) * 1000;
        const watchdog = setTimeout(() => {
            void (async () => {
                this.logger.warn(`run ${runId} exceeded ${watchdogMs / 1000}s without terminating; aborting stalled stream`);
                try {
                    await this.engine.cancelExecution(runId, correlationId);
                }
                catch {
                }
                const stalled = await this.runs.findOne({ where: { id: runId } });
                if (stalled && !(0, state_machines_1.isTerminalExecutionStatus)(stalled.status)) {
                    stalled.status = 'timed_out';
                    stalled.finishedAt = new Date();
                    await this.runs.save(stalled);
                    this.emitStatus(stalled, correlationId);
                }
                controller.abort();
            })();
        }, watchdogMs);
        const onEvent = async (evt) => {
            const type = evt.type === 'execution.status' ? 'execution.status' : 'execution.step';
            const payload = evt.payload || {};
            const envelope = this.events.emit({
                type,
                projectId,
                runId,
                correlationId,
                payload,
            });
            await this.execEvents.save(this.execEvents.create({
                executionRunId: runId,
                projectId,
                seq: envelope.seq,
                type,
                testCaseId: String(payload.test_case_id ?? ''),
                testName: String(payload.test_name ?? ''),
                sequence: Number(payload.sequence ?? 0),
                actionType: String(payload.action_type ?? ''),
                target: String(payload.target ?? ''),
                valueSummary: String(payload.value_summary ?? ''),
                status: String(payload.status ?? ''),
                currentUrl: String(payload.current_url ?? ''),
                elapsedMs: Number(payload.elapsed_ms ?? 0),
                evidenceUri: String(payload.evidence_uri ?? ''),
                ts: String(payload.ts ?? ''),
                payload,
            }));
            if (type === 'execution.step' &&
                payload.action_type === 'test' &&
                ['passed', 'failed', 'skipped'].includes(String(payload.status))) {
                testOutcomes.set(String(payload.test_name || payload.test_case_id || ''), String(payload.status));
            }
            await this.logEngineEvent(runId, projectId, type, payload, correlationId);
            if (type === 'execution.status') {
                await this.onStatusEvent(runId, payload, correlationId);
            }
        };
        try {
            await this.engine.streamRunEvents(runId, onEvent, {
                correlationId,
                signal: controller.signal,
            });
        }
        catch (err) {
            this.logger.warn(`event stream for run ${runId} ended with error: ${err.message}`);
        }
        finally {
            clearTimeout(watchdog);
            this.abortControllers.delete(runId);
            await this.finalize(runId, testOutcomes, correlationId);
            this.activeRuns.delete(runId);
            void this.pump(correlationId);
        }
    }
    async logEngineEvent(runId, projectId, type, payload, correlationId) {
        const log = this.log({ id: runId, projectId }, correlationId);
        const state = this.runStreams.get(runId);
        const pct = () => {
            if (!state || state.total <= 0)
                return null;
            return Math.max(0, Math.min(100, Math.round((state.completed / state.total) * 100)));
        };
        if (type === 'execution.status') {
            const status = String(payload.status || '');
            if (['preparing', 'running'].includes(status) && payload.detail) {
                await log.debug(String(payload.detail));
            }
            return;
        }
        if (type !== 'execution.step')
            return;
        const action = String(payload.action_type || '');
        const status = String(payload.status || '');
        const name = prettyTest(String(payload.test_name || payload.test_case_id || ''));
        const testCaseId = String(payload.test_case_id || payload.test_name || '');
        const elapsedMs = Number(payload.elapsed_ms ?? 0);
        if (action === 'collected') {
            const count = Number(payload.sequence ?? payload.target ?? 0);
            if (state) {
                state.total = count || state.total;
                state.collected = true;
            }
            log.setStage('Running Tests');
            await log.info(`Found ${count} test case(s).`, { stage: 'Discovering Tests' });
            return;
        }
        if (action === 'test') {
            if (status === 'running') {
                if (state) {
                    state.started += 1;
                    state.testStart.set(testCaseId, elapsedMs);
                }
                const idx = state?.started ?? 0;
                const total = state?.total ?? 0;
                await log.progress(idx, total, `Running test ${idx}${total ? ` of ${total}` : ''}: ${name}`, { testCaseId, testName: name });
                return;
            }
            if (['passed', 'failed', 'skipped'].includes(status)) {
                if (state)
                    state.completed += 1;
                const startedAt = state?.testStart.get(testCaseId);
                const durationMs = startedAt !== undefined ? Math.max(0, elapsedMs - startedAt) : undefined;
                const dur = durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : '';
                const meta = { testCaseId };
                if (durationMs !== undefined)
                    meta.durationMs = durationMs;
                if (status === 'passed') {
                    await log.pass(`${name} passed${dur}`, { testCaseId, testName: name, progress: pct(), meta });
                }
                else if (status === 'skipped') {
                    await log.info(`${name} skipped`, { testCaseId, testName: name, progress: pct(), meta });
                }
                else {
                    const reason = state?.lastError.get(testCaseId);
                    if (reason)
                        meta.reason = reason;
                    await log.fail(`${name} failed${dur}${reason ? ` — ${reason}` : ''}`, {
                        testCaseId,
                        testName: name,
                        progress: pct(),
                        meta,
                    });
                }
                return;
            }
            return;
        }
        if (status === 'failed') {
            const target = String(payload.target || '');
            const value = String(payload.value_summary || '');
            const detail = [target, value].filter(Boolean).join(' — ');
            if (detail) {
                if (state && testCaseId)
                    state.lastError.set(testCaseId, target || detail);
                await log.error(detail, { testCaseId, testName: name });
            }
        }
    }
    async onStatusEvent(runId, payload, correlationId) {
        const engineStatus = String(payload.status || '');
        const run = await this.runs.findOne({ where: { id: runId } });
        if (!run || (0, state_machines_1.isTerminalExecutionStatus)(run.status))
            return;
        if (engineStatus === 'completed' ||
            engineStatus === 'error' ||
            engineStatus === 'cancelled' ||
            engineStatus === 'timed_out') {
            const metrics = payload.metrics || undefined;
            run.metrics = payload.metrics || run.metrics;
            run.finishedAt = new Date();
            run.status =
                engineStatus === 'cancelled'
                    ? 'cancelled'
                    : engineStatus === 'timed_out'
                        ? 'timed_out'
                        : engineStatus === 'error'
                            ? 'failed'
                            : (0, state_machines_1.outcomeFromMetrics)(metrics ?? run.metrics ?? {});
            await this.runs.save(run);
            this.emitStatus(run, correlationId, { metrics: run.metrics });
        }
        else if (engineStatus === 'running' && ['queued', 'preparing'].includes(run.status)) {
            run.startedAt = run.startedAt || new Date();
            await this.setStatus(run, 'running', correlationId);
        }
    }
    async finalize(runId, testOutcomes, correlationId) {
        const run = await this.runs.findOne({ where: { id: runId } });
        if (!run)
            return;
        const log = this.log(run, correlationId);
        await log.stage('Capturing Evidence', 'Collecting screenshots, traces and videos…');
        const existing = await this.results.count({
            where: { executionRunId: runId },
        });
        if (!existing && testOutcomes.size) {
            const rows = [...testOutcomes.entries()].map(([nodeId, outcome]) => this.results.create({
                executionRunId: runId,
                nodeId,
                outcome,
                durationSeconds: 0,
                errorMessage: '',
                evidence: null,
            }));
            await this.results.save(rows);
        }
        if (!(0, state_machines_1.isTerminalExecutionStatus)(run.status)) {
            run.status =
                run.status === 'stopping'
                    ? 'cancelled'
                    : (0, state_machines_1.outcomeFromMetrics)(run.metrics ?? {});
            run.finishedAt = run.finishedAt || new Date();
            await this.runs.save(run);
            this.emitStatus(run, correlationId);
        }
        await this.logTerminal(run, log);
        if (run.createdBy) {
            await this.notifications.notify({
                userId: run.createdBy,
                projectId: run.projectId,
                type: 'execution.finished',
                title: `Execution ${run.status.replace(/_/g, ' ')} (${run.browser}, ${run.headed ? 'headed' : 'headless'})`,
                message: summariseMetrics(run.metrics),
                resourceType: 'execution',
                resourceId: run.id,
                correlationId,
            });
        }
        this.forgetRun(runId);
    }
    async logTerminal(run, log) {
        const metrics = (run.metrics ?? {});
        const summary = summariseMetrics(run.metrics);
        const err = metrics.error ? String(metrics.error) : '';
        const meta = err ? { error: err } : undefined;
        switch (run.status) {
            case 'passed':
                log.setStage('Completed');
                await log.success(`Execution completed successfully — ${summary}.`, {
                    progress: 100,
                });
                break;
            case 'partially_passed':
                log.setStage('Completed');
                await log.warning(`Execution completed with failures — ${summary}.`, {
                    progress: 100,
                });
                break;
            case 'failed':
                log.setStage('Failed');
                await log.fail(`Execution failed — ${summary}.`, { progress: 100, meta });
                break;
            case 'timed_out':
                log.setStage('Failed');
                await log.error('Execution timed out before completing.', {
                    progress: 100,
                    meta,
                });
                break;
            case 'cancelled':
                log.setStage('Failed');
                await log.warning('Execution cancelled.', { progress: 100 });
                break;
            default:
                log.setStage('Failed');
                await log.error(`Execution ended (${run.status}) — ${err || summary}.`, {
                    progress: 100,
                    meta,
                });
        }
    }
    async getOne(id, user) {
        const run = await this.runs.findOne({ where: { id } });
        if (!run)
            throw new errors_1.NotFoundAppException(`Execution ${id} not found`);
        await this.membership.ensureMember(run.projectId, user);
        return run;
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        return this.runs.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
    async getEvents(id, user, fromSeq = 0) {
        const run = await this.getOne(id, user);
        const events = await this.execEvents.find({
            where: {
                executionRunId: id,
                ...(fromSeq ? { seq: (0, typeorm_2.MoreThan)(fromSeq) } : {}),
            },
            order: { seq: 'ASC' },
            take: 5000,
        });
        const last = events[events.length - 1];
        if (last)
            this.events.primeSeq(run.projectId, id, last.seq);
        return events;
    }
    async getLogs(id, user, fromSeq = 0) {
        await this.getOne(id, user);
        return this.execLog.fetch(id, fromSeq);
    }
    async cancel(id, user, correlationId) {
        const run = await this.getOne(id, user);
        if ((0, state_machines_1.isTerminalExecutionStatus)(run.status)) {
            throw new errors_1.ConflictAppException(`Execution ${id} is already ${run.status}.`, 'invalid_state_transition');
        }
        const controller = this.abortControllers.get(id);
        const log = this.log(run, correlationId);
        await log.warning(`Cancellation requested by ${user.email}.`);
        if (run.status === 'queued') {
            run.status = 'cancelled';
            run.finishedAt = new Date();
            await this.runs.save(run);
            this.emitStatus(run, correlationId);
            await this.logTerminal(run, log);
            this.forgetRun(id);
        }
        else {
            await this.setStatus(run, 'stopping', correlationId);
            await log.info('Stopping the runner and its browser…');
        }
        let cancelled = true;
        try {
            const res = await this.engine.cancelExecution(id, correlationId);
            cancelled = res.cancelled;
        }
        catch {
            cancelled = false;
        }
        if (run.status === 'stopping') {
            run.status = 'cancelled';
            run.finishedAt = new Date();
            await this.runs.save(run);
            this.emitStatus(run, correlationId);
        }
        if (controller)
            controller.abort();
        this.activeRuns.delete(id);
        void this.pump(correlationId);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'execution.cancel',
            resourceType: 'execution',
            resourceId: id,
            projectId: run.projectId,
            correlationId,
        });
        return { id, cancelled, status: run.status };
    }
    async getResults(id, user) {
        await this.getOne(id, user);
        return this.results.find({ where: { executionRunId: id } });
    }
    async getStoredReport(id, user) {
        const run = await this.getOne(id, user);
        return run.report;
    }
};
exports.ExecutionsService = ExecutionsService;
exports.ExecutionsService = ExecutionsService = ExecutionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ExecutionRun)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.ExecutionEvent)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.TestResult)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.GeneratedArtifact)),
    __param(4, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        events_service_1.EventsService,
        notifications_service_1.NotificationsService,
        config_1.ConfigService,
        engine_client_1.EngineClient,
        execution_logger_service_1.ExecutionLoggerService])
], ExecutionsService);
function summariseMetrics(metrics) {
    if (!metrics)
        return '';
    const p = metrics.passed ?? 0;
    const f = metrics.failed ?? 0;
    const s = metrics.skipped ?? 0;
    return `passed ${p}, failed ${f}, skipped ${s}`;
}
//# sourceMappingURL=executions.service.js.map