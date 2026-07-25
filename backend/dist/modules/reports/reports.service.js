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
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const errors_2 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const approvals_service_1 = require("../approvals/approvals.service");
const membership_service_1 = require("../../common/access/membership.service");
const jobs_service_1 = require("../jobs/jobs.service");
const engine_client_1 = require("../../engine/engine.client");
let ReportsService = class ReportsService {
    constructor(runs, results, projects, findings, membership, audit, approvals, jobs, engine) {
        this.runs = runs;
        this.results = results;
        this.projects = projects;
        this.findings = findings;
        this.membership = membership;
        this.audit = audit;
        this.approvals = approvals;
        this.jobs = jobs;
        this.engine = engine;
        this.jobs.registerRetryHandler('report', (original, user, correlationId) => this.generate(original.inputRefs?.executionRunId ?? '', user, correlationId));
    }
    async loadRun(id, user) {
        const run = await this.runs.findOne({ where: { id } });
        if (!run)
            throw new errors_1.NotFoundAppException(`Execution ${id} not found`);
        await this.membership.ensureMember(run.projectId, user);
        return run;
    }
    buildCounts(run, results) {
        const metrics = (run.metrics ?? {});
        const byOutcome = (o) => results.filter((r) => r.outcome === o).length;
        const passed = results.length ? byOutcome('passed') : metrics.passed ?? 0;
        const failed = results.length ? byOutcome('failed') : metrics.failed ?? 0;
        const skipped = results.length ? byOutcome('skipped') : metrics.skipped ?? 0;
        const blocked = results.length
            ? byOutcome('error') + byOutcome('blocked')
            : metrics.errors ?? 0;
        const flaky = results.length ? byOutcome('flaky') : metrics.flaky ?? 0;
        const executed = passed + failed + skipped + blocked + flaky;
        const planned = metrics.total ?? executed;
        const notRun = Math.max(0, planned - executed);
        const total = Math.max(planned, executed);
        const denominator = passed + failed + flaky;
        return {
            total,
            passed,
            failed,
            skipped,
            blocked,
            flaky,
            notRun,
            passRate: denominator
                ? Math.round(((passed + flaky) / denominator) * 100)
                : 0,
        };
    }
    async generate(id, user, correlationId) {
        const run = await this.loadRun(id, user);
        const job = await this.jobs.create({
            projectId: run.projectId,
            type: 'report',
            correlationId,
            inputRefs: { executionRunId: id },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'report.generate',
            resourceType: 'execution',
            resourceId: id,
            projectId: run.projectId,
            correlationId,
            metadata: { jobId: job.id },
        });
        this.jobs.dispatch(job, async (j, ctx) => {
            await ctx.log({
                stage: 'result aggregation',
                message: `Aggregating results and metrics for execution ${id}`,
                progress: 15,
            });
            const results = await this.results.find({ where: { executionRunId: id } });
            const project = await this.projects.findOne({
                where: { id: run.projectId },
            });
            const runFindings = await this.findings.find({
                where: { executionRunId: id },
            });
            const counts = this.buildCounts(run, results);
            await ctx.log({
                stage: 'evidence linking',
                message: `Linking ${results.length} test result(s) and ${runFindings.length} classification(s) to evidence`,
                progress: 40,
            });
            const data = {
                project: project
                    ? {
                        name: project.name,
                        base_url: project.baseUrl,
                        environment: project.environment,
                    }
                    : undefined,
                run_summary: {
                    run_id: run.id,
                    project_id: run.projectId,
                    status: run.status,
                    environment: run.environment,
                    browser: run.browser,
                    mode: run.mode,
                    headed: run.headed,
                    run_scope: run.runScope,
                    settings: run.settings || {},
                    ci_run_id: run.ciRunId,
                    ci_url: run.ciUrl,
                    started_at: run.startedAt,
                    finished_at: run.finishedAt,
                    metrics: run.metrics || {},
                },
                counts: counts,
                tests: results.map((r) => ({
                    node_id: r.nodeId,
                    outcome: r.outcome,
                    duration_seconds: r.durationSeconds,
                    error_message: r.errorMessage,
                    evidence: r.evidence || null,
                })),
                classifications: runFindings.map((f) => ({
                    id: f.id,
                    test_result_id: f.testResultId,
                    classification: f.classification,
                    confidence: f.confidence,
                    rationale: f.rationale,
                    severity: f.severity,
                    overridden: f.overridden,
                })),
                metrics: run.metrics || {},
                evidence: run.evidence || {},
            };
            await ctx.log({
                stage: 'report rendering',
                message: 'Rendering HTML/Markdown report and AI narrative',
                progress: 65,
            });
            const report = await this.engine.report({ data }, correlationId);
            const built = {
                data: report.data ?? data,
                counts,
                html: report.html ?? '',
                md: report.md ?? '',
            };
            const fresh = await this.runs.findOne({ where: { id } });
            if (fresh) {
                fresh.report = built;
                await this.runs.save(fresh);
            }
            await ctx.log({
                stage: 'completed',
                severity: 'success',
                message: `Report stored (pass rate ${counts.passRate}%, ${counts.total} tests)`,
                progress: 100,
            });
            return { resultRefs: { executionRunId: id, reportStored: true } };
        });
        return { jobId: job.id, status: job.status, executionRunId: id };
    }
    async decidePublication(id, decision, comment, user, correlationId) {
        const run = await this.loadRun(id, user);
        if (!run.report) {
            throw new errors_2.ConflictAppException(`No report generated for execution ${id} yet; generate it before deciding publication.`, 'report_missing');
        }
        const record = await this.approvals.recordStandalone('report', id, run.projectId, decision, comment, user, correlationId);
        return { executionRunId: id, decision: record.decision };
    }
    async export(id, format, user) {
        const run = await this.loadRun(id, user);
        const publication = await this.approvals.latestStandalone('report', id);
        if (publication?.decision === 'rejected') {
            throw new errors_2.ConflictAppException(`Report for execution ${id} was rejected for publication and cannot be exported.`, 'report_publication_rejected');
        }
        const report = run.report;
        const base = `execution-${id}-report`;
        if (format === 'json') {
            return {
                contentType: 'application/json',
                filename: `${base}.json`,
                body: JSON.stringify(report ?? { message: 'report not generated' }, null, 2),
            };
        }
        if (format === 'junit') {
            const results = await this.results.find({
                where: { executionRunId: id },
            });
            return {
                contentType: 'application/xml',
                filename: `${base}.junit.xml`,
                body: renderJunit(id, results),
            };
        }
        if (format === 'csv') {
            const results = await this.results.find({
                where: { executionRunId: id },
            });
            const counts = this.buildCounts(run, results);
            return {
                contentType: 'text/csv',
                filename: `${base}.csv`,
                body: renderCsv(run, counts, results),
            };
        }
        if (format === 'html') {
            const html = report?.html ||
                `<html><body><h1>Execution ${id}</h1><pre>${escapeHtml(JSON.stringify(run.metrics || {}, null, 2))}</pre></body></html>`;
            return { contentType: 'text/html', filename: `${base}.html`, body: html };
        }
        const html = report?.html || `<html><body><h1>Execution ${id}</h1></body></html>`;
        try {
            const { pdfBase64 } = await this.engine.renderPdf(html);
            return {
                contentType: 'application/pdf',
                filename: `${base}.pdf`,
                body: Buffer.from(pdfBase64, 'base64'),
            };
        }
        catch {
            return { contentType: 'text/html', filename: `${base}.html`, body: html };
        }
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ExecutionRun)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.TestResult)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.Finding)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        approvals_service_1.ApprovalsService,
        jobs_service_1.JobsService,
        engine_client_1.EngineClient])
], ReportsService);
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function renderCsv(run, counts, results) {
    const lines = [];
    lines.push('# Execution report');
    lines.push(['run_id', 'status', 'browser', 'mode', 'environment', 'started_at', 'finished_at'].join(','));
    lines.push([
        run.id,
        run.status,
        run.browser,
        run.headed ? 'headed' : 'headless',
        run.environment,
        run.startedAt?.toISOString?.() ?? run.startedAt ?? '',
        run.finishedAt?.toISOString?.() ?? run.finishedAt ?? '',
    ]
        .map(csvEscape)
        .join(','));
    lines.push('');
    lines.push('# Counts');
    lines.push('total,passed,failed,skipped,blocked,flaky,not_run,pass_rate');
    lines.push([
        counts.total,
        counts.passed,
        counts.failed,
        counts.skipped,
        counts.blocked,
        counts.flaky,
        counts.notRun,
        `${counts.passRate}%`,
    ].join(','));
    lines.push('');
    lines.push('# Tests');
    lines.push('node_id,outcome,duration_seconds,error_message');
    for (const r of results) {
        lines.push([r.nodeId, r.outcome, r.durationSeconds, r.errorMessage]
            .map(csvEscape)
            .join(','));
    }
    return lines.join('\n') + '\n';
}
function renderJunit(runId, results) {
    const failures = results.filter((r) => r.outcome === 'failed').length;
    const skipped = results.filter((r) => r.outcome === 'skipped').length;
    const cases = results
        .map((r) => {
        const inner = r.outcome === 'failed'
            ? `<failure message="${escapeHtml(r.errorMessage || 'failed')}"/>`
            : r.outcome === 'skipped'
                ? '<skipped/>'
                : '';
        return `    <testcase name="${escapeHtml(r.nodeId)}" time="${r.durationSeconds}">${inner}</testcase>`;
    })
        .join('\n');
    return (`<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<testsuite name="run-${runId}" tests="${results.length}" failures="${failures}" skipped="${skipped}">\n` +
        `${cases}\n</testsuite>\n`);
}
//# sourceMappingURL=reports.service.js.map