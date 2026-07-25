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
exports.AutomationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const hash_1 = require("../../common/hash");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
const jobs_service_1 = require("../jobs/jobs.service");
const approvals_service_1 = require("../approvals/approvals.service");
const membership_service_1 = require("../../common/access/membership.service");
const engine_client_1 = require("../../engine/engine.client");
let AutomationService = class AutomationService {
    constructor(artifacts, cases, runs, projects, membership, audit, events, jobs, approvals, engine) {
        this.artifacts = artifacts;
        this.cases = cases;
        this.runs = runs;
        this.projects = projects;
        this.membership = membership;
        this.audit = audit;
        this.events = events;
        this.jobs = jobs;
        this.approvals = approvals;
        this.engine = engine;
        this.jobs.registerRetryHandler('automation', (original, user, correlationId) => this.generate(original.projectId, {
            testCaseIds: original.inputRefs?.testCaseIds ?? [],
            draftPreview: !!original.inputRefs?.draftPreview,
        }, user, correlationId));
        this.jobs.registerRetryHandler('validation', (original, user, correlationId) => this.validate(original.inputRefs?.artifactId ?? '', user, correlationId));
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        await this.membership.ensureMember(projectId, user);
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        const cases = await this.cases.find({
            where: { projectId, id: (0, typeorm_2.In)(dto.testCaseIds) },
        });
        if (!cases.length) {
            throw new errors_1.NotFoundAppException('No matching test cases found');
        }
        if (!dto.draftPreview) {
            const unapproved = cases.filter((c) => c.approvalStatus !== 'approved');
            if (unapproved.length) {
                throw new errors_1.ConflictAppException(`Cannot generate automation: ${unapproved.length} of ${cases.length} ` +
                    `test cases are not approved. Approve them or pass draftPreview=true.`, 'approval_required', { unapprovedTestCaseIds: unapproved.map((c) => c.id) });
            }
        }
        const job = await this.jobs.create({
            projectId,
            type: 'automation',
            correlationId,
            idempotencyKey,
            inputRefs: { testCaseIds: dto.testCaseIds, draftPreview: !!dto.draftPreview },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'automation.generate',
            resourceType: 'job',
            resourceId: job.id,
            projectId,
            correlationId,
            metadata: { testCases: cases.length, draftPreview: !!dto.draftPreview },
        });
        this.jobs.dispatch(job, async (j, ctx) => {
            await ctx.log({
                stage: 'framework selection',
                message: `Generating ${project.runner} Playwright automation for ${cases.length} approved test case(s)`,
                progress: 10,
            });
            await ctx.checkpoint();
            await ctx.log({
                stage: 'file generation',
                message: `Creating page objects, locators and assertions with ${project.llmModel || 'the default model'}`,
                progress: 25,
            });
            const output = await this.engine.automation({
                testCases: cases.map((c) => ({
                    id: c.id,
                    case_key: c.caseKey,
                    title: c.title,
                    steps: c.steps ?? [],
                    expected_results: c.expectedResults ?? [],
                    test_data: c.testData ?? {},
                    preconditions: c.preconditions ?? [],
                })),
                baseUrl: project.baseUrl,
                pageObjectsSummary: '',
                model: project.llmModel || undefined,
                temperature: project.llmTemperature,
            }, correlationId, idempotencyKey);
            await ctx.log({
                stage: 'formatting',
                message: 'Generated files returned; formatting and persisting artefacts',
                progress: 80,
            });
            const run = await this.runs.save(this.runs.create({
                projectId,
                kind: 'automation',
                jobId: job.id,
                model: project.llmModel,
                temperature: project.llmTemperature,
                contentHash: (0, hash_1.contentHash)(output),
                status: 'completed',
            }));
            const files = output.files || [];
            const artifactIds = [];
            for (const f of files) {
                const saved = await this.artifacts.save(this.artifacts.create({
                    projectId,
                    generationRunId: run.id,
                    testCaseIds: f.test_case_ids || dto.testCaseIds,
                    path: f.path || 'generated_test.py',
                    kind: f.kind || 'test_file',
                    content: f.content || '',
                    diff: '',
                    traceability: {
                        testCaseIds: f.test_case_ids || dto.testCaseIds,
                        notes: output.notes || '',
                    },
                    contentHash: (0, hash_1.contentHash)(f.content || ''),
                    version: 1,
                    status: 'active',
                    validationStatus: 'pending',
                    approvalStatus: 'pending',
                    schemaVersion: output.schema_version || 'v1',
                    createdBy: user.id,
                }));
                artifactIds.push(saved.id);
            }
            this.events.emit({
                type: 'automation.ready',
                projectId,
                jobId: job.id,
                correlationId,
                payload: { artifactIds, count: artifactIds.length },
            });
            return {
                resultRefs: { artifactIds, generationRunId: run.id },
                readyEvent: {
                    type: 'automation.ready',
                    payload: { artifactIds, count: artifactIds.length },
                },
            };
        });
        return { jobId: job.id, status: job.status };
    }
    async getOne(id, user) {
        const art = await this.artifacts.findOne({ where: { id } });
        if (!art)
            throw new errors_1.NotFoundAppException(`Automation artifact ${id} not found`);
        await this.membership.ensureMember(art.projectId, user);
        return art;
    }
    async updateContent(id, content, user, correlationId) {
        const art = await this.getOne(id, user);
        if (art.status !== 'active') {
            throw new errors_1.ConflictAppException(`Automation ${id} is ${art.status} and cannot be edited.`, 'invalid_state_transition', { artifactId: id, status: art.status });
        }
        if (content === art.content) {
            return art;
        }
        art.content = content;
        art.contentHash = (0, hash_1.contentHash)(content);
        art.version += 1;
        art.diff = '';
        art.validationStatus = 'pending';
        art.validationReport = null;
        await this.artifacts.save(art);
        await this.approvals.onUpstreamModified('automation', id, user, correlationId);
        const updated = await this.getOne(id, user);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'automation.edit',
            resourceType: 'automation',
            resourceId: id,
            projectId: updated.projectId,
            correlationId,
            metadata: {
                version: updated.version,
                contentHash: updated.contentHash,
                revalidationRequired: true,
                approvalInvalidated: updated.approvalInvalidated,
            },
        });
        this.events.emit({
            type: 'automation.ready',
            projectId: updated.projectId,
            correlationId,
            payload: { artifactIds: [id], count: 1, reason: 'edited' },
        });
        return updated;
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        return this.artifacts.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
        });
    }
    async validate(id, user, correlationId) {
        const art = await this.getOne(id, user);
        const project = await this.projects.findOne({
            where: { id: art.projectId },
        });
        const job = await this.jobs.create({
            projectId: art.projectId,
            type: 'validation',
            correlationId,
            inputRefs: { artifactId: id, path: art.path },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'automation.validate',
            resourceType: 'automation',
            resourceId: id,
            projectId: art.projectId,
            correlationId,
            metadata: { jobId: job.id },
        });
        art.validationStatus = 'running';
        await this.artifacts.save(art);
        this.jobs.dispatch(job, async (j, ctx) => {
            await ctx.log({
                stage: 'syntax',
                message: `Validating ${art.path}: Python syntax, imports and Pytest collection`,
                progress: 15,
            });
            const report = await this.engine.validate({
                files: [{ path: art.path, content: art.content }],
                allowedDomains: (project?.allowedDomains || 'localhost,127.0.0.1').split(','),
                runCollection: true,
            }, correlationId);
            await ctx.log({
                stage: 'policy scan',
                message: 'Checking forbidden operations, hard-coded secrets, locator quality and the domain allow-list',
                progress: 70,
            });
            const passed = report.passed === true;
            const findings = report.findings || [];
            const warnings = findings.filter((f) => (f.severity || '').toLowerCase() === 'warning');
            const fresh = await this.artifacts.findOne({ where: { id } });
            if (fresh) {
                fresh.validationReport = report;
                fresh.validationStatus = passed
                    ? warnings.length
                        ? 'passed_with_warnings'
                        : 'passed'
                    : 'failed';
                await this.artifacts.save(fresh);
            }
            await ctx.log({
                stage: 'result',
                severity: passed ? (warnings.length ? 'warning' : 'success') : 'error',
                message: passed
                    ? warnings.length
                        ? `Validation passed with ${warnings.length} warning(s)`
                        : 'Validation passed'
                    : `Validation failed with ${findings.length} finding(s)`,
                progress: 95,
            });
            this.events.emit({
                type: 'validation.ready',
                projectId: art.projectId,
                jobId: job.id,
                correlationId,
                payload: {
                    artifactId: id,
                    passed,
                    validationStatus: fresh?.validationStatus,
                },
            });
            return {
                resultRefs: {
                    artifactId: id,
                    validationStatus: fresh?.validationStatus ?? 'failed',
                },
                warnings: warnings.length && passed ? [`${warnings.length} validation warning(s)`] : [],
            };
        });
        return { jobId: job.id, status: job.status, artifactId: id };
    }
    async overrideValidation(id, reason, user, correlationId) {
        const art = await this.getOne(id, user);
        if (!reason?.trim()) {
            throw new errors_1.ConflictAppException('A written reason is required to override validation.', 'reason_required');
        }
        art.validationStatus = 'overridden';
        await this.artifacts.save(art);
        await this.approvals.recordStandalone('validation_exception', id, art.projectId, 'approved', reason, user, correlationId);
        this.events.emit({
            type: 'validation.ready',
            projectId: art.projectId,
            correlationId,
            payload: { artifactId: id, passed: true, validationStatus: 'overridden' },
        });
        return { artifactId: id, validationStatus: art.validationStatus };
    }
    async approve(id, decision, comment, user, correlationId) {
        const art = await this.getOne(id, user);
        const validated = ['passed', 'passed_with_warnings', 'overridden'].includes(art.validationStatus);
        if (decision === 'approved' && !validated) {
            throw new errors_1.ConflictAppException(`Automation ${id} must pass validation before approval ` +
                `(current: ${art.validationStatus}).`, 'validation_required', { artifactId: id, validationStatus: art.validationStatus });
        }
        return this.approvals.decide('automation', id, decision, comment, user, correlationId);
    }
    async executionPlan(id, user, correlationId) {
        const art = await this.getOne(id, user);
        const project = await this.projects.findOne({
            where: { id: art.projectId },
        });
        const cases = await this.cases.find({
            where: { id: (0, typeorm_2.In)(art.testCaseIds ?? []) },
        });
        const raw = (await this.engine.executionPlan({
            testCases: cases.map((c) => ({
                id: c.id,
                case_key: c.caseKey,
                title: c.title,
                steps: c.steps ?? [],
                expected_results: c.expectedResults ?? [],
            })),
            baseUrl: project?.baseUrl || '',
        }, correlationId));
        const plans = (raw.plans ?? []).map((p) => ({
            testCaseId: String(p.test_case_id ?? p.testCaseId ?? ''),
            caseKey: String(p.case_key ?? p.caseKey ?? ''),
            title: String(p.title ?? ''),
            steps: (p.steps ?? []).map((s) => ({
                sequence: Number(s.sequence ?? 0),
                actionType: String(s.action_type ?? s.actionType ?? ''),
                target: String(s.target ?? ''),
                description: String(s.description ?? ''),
                expected: String(s.expected ?? ''),
            })),
        }));
        return { schemaVersion: raw.schema_version ?? 'v1', plans };
    }
};
exports.AutomationService = AutomationService;
exports.AutomationService = AutomationService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.GeneratedArtifact)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.TestCase)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.GenerationRun)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        events_service_1.EventsService,
        jobs_service_1.JobsService,
        approvals_service_1.ApprovalsService,
        engine_client_1.EngineClient])
], AutomationService);
//# sourceMappingURL=automation.service.js.map