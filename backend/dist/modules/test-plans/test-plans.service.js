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
exports.TestPlansService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const hash_1 = require("../../common/hash");
const state_machines_1 = require("../../common/state-machines");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
const jobs_service_1 = require("../jobs/jobs.service");
const approvals_service_1 = require("../approvals/approvals.service");
const membership_service_1 = require("../../common/access/membership.service");
const requirement_derivation_service_1 = require("../requirements/requirement-derivation.service");
const engine_client_1 = require("../../engine/engine.client");
let TestPlansService = class TestPlansService {
    constructor(plans, revisions, requirements, analyses, runs, projects, membership, audit, events, jobs, approvals, derivation, engine) {
        this.plans = plans;
        this.revisions = revisions;
        this.requirements = requirements;
        this.analyses = analyses;
        this.runs = runs;
        this.projects = projects;
        this.membership = membership;
        this.audit = audit;
        this.events = events;
        this.jobs = jobs;
        this.approvals = approvals;
        this.derivation = derivation;
        this.engine = engine;
        this.jobs.registerRetryHandler('test_plan', (original, user, correlationId) => this.generate(original.projectId, {
            requirementIds: original.inputRefs?.requirementIds ?? undefined,
        }, user, correlationId));
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        await this.membership.ensureMember(projectId, user);
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        const requirements = await this.derivation.resolveGenerationScope(projectId, dto.requirementIds, undefined, user, correlationId);
        const analyses = await this.analyses.find({ where: { projectId } });
        const job = await this.jobs.create({
            projectId,
            type: 'test_plan',
            correlationId,
            idempotencyKey,
            inputRefs: { requirementIds: requirements.map((r) => r.id) },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'test_plan.generate',
            resourceType: 'job',
            resourceId: job.id,
            projectId,
            correlationId,
        });
        this.jobs.dispatch(job, async (j, ctx) => {
            await ctx.log({
                stage: 'requirement mapping',
                message: `Mapping ${requirements.length} requirement(s) and ${analyses.length} analysis result(s) into the plan scope`,
                progress: 10,
            });
            await ctx.checkpoint();
            await ctx.log({
                stage: 'scope generation',
                message: `Generating plan sections with ${project.llmModel || 'the default model'} (objectives, scope, environments, entry/exit criteria)`,
                progress: 25,
            });
            const output = await this.engine.testPlan({
                projectName: project.name,
                baseUrl: project.baseUrl,
                requirements: requirements.map((r) => ({
                    id: r.id,
                    title: r.title,
                    text: r.text,
                    acceptance_criteria: r.acceptanceCriteria ?? [],
                })),
                analyses: analyses.map((a) => a.output),
                model: project.llmModel || undefined,
                temperature: project.llmTemperature,
            }, correlationId, idempotencyKey);
            await ctx.log({
                stage: 'risk analysis',
                message: 'Plan sections returned; validating structure and risk coverage',
                progress: 75,
            });
            await ctx.checkpoint();
            const run = await this.runs.save(this.runs.create({
                projectId,
                kind: 'test_plan',
                jobId: job.id,
                model: project.llmModel,
                temperature: project.llmTemperature,
                contentHash: (0, hash_1.contentHash)(output),
                status: 'completed',
            }));
            await ctx.log({
                stage: 'persistence',
                message: 'Saving the test plan and opening revision v1',
                progress: 90,
            });
            const plan = await this.plans.save(this.plans.create({
                projectId,
                generationRunId: run.id,
                title: dto.title || `${project.name} Test Plan`,
                version: 1,
                approvalStatus: 'pending',
                schemaVersion: output.schema_version || 'v1',
                contentHash: (0, hash_1.contentHash)(output),
                sections: output,
                model: project.llmModel,
                createdBy: user.id,
            }));
            await this.saveRevision(plan, user, 'generated', 'Initial generated plan');
            return {
                resultRefs: { testPlanId: plan.id, generationRunId: run.id },
                readyEvent: {
                    type: 'plan.ready',
                    payload: { testPlanId: plan.id },
                },
            };
        });
        return { jobId: job.id, status: job.status };
    }
    async saveRevision(plan, user, sourceAction, changeSummary) {
        const last = await this.revisions.findOne({
            where: { testPlanId: plan.id },
            order: { version: 'DESC' },
        });
        const version = (last?.version ?? 0) + 1;
        plan.version = version;
        await this.plans.save(plan);
        return this.revisions.save(this.revisions.create({
            testPlanId: plan.id,
            projectId: plan.projectId,
            version,
            title: plan.title,
            sections: plan.sections,
            contentHash: plan.contentHash,
            sourceAction,
            changeSummary,
            approvalStatus: plan.approvalStatus,
            author: user?.email ?? 'system',
            authorId: user?.id ?? null,
        }));
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        const plans = await this.plans.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
        });
        return plans.map((p) => this.withState(p));
    }
    async getOne(id, user) {
        const plan = await this.plans.findOne({ where: { id } });
        if (!plan)
            throw new errors_1.NotFoundAppException(`Test plan ${id} not found`);
        await this.membership.ensureMember(plan.projectId, user);
        return this.withState(plan);
    }
    withState(plan) {
        return Object.assign(plan, {
            artefactState: (0, state_machines_1.deriveArtefactState)(plan),
        });
    }
    async update(id, dto, user, correlationId) {
        const plan = await this.getOne(id, user);
        const changed = [];
        if (dto.title !== undefined && dto.title !== plan.title) {
            plan.title = dto.title;
            changed.push('title');
        }
        if (dto.sections) {
            changed.push(...Object.keys(dto.sections));
            plan.sections = { ...(plan.sections || {}), ...dto.sections };
        }
        plan.contentHash = (0, hash_1.contentHash)(plan.sections);
        await this.saveRevision(plan, user, 'edited', dto.changeSummary || `Edited: ${changed.join(', ') || 'no-op'}`);
        await this.approvals.onUpstreamModified('test_plan', id, user, correlationId);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'test_plan.update',
            resourceType: 'test_plan',
            resourceId: id,
            projectId: plan.projectId,
            correlationId,
            metadata: { version: plan.version, changed },
        });
        return this.getOne(id, user);
    }
    async approve(id, decision, comment, user, correlationId) {
        const plan = await this.getOne(id, user);
        const result = await this.approvals.decide('test_plan', id, decision, comment, user, correlationId);
        const latest = await this.revisions.findOne({
            where: { testPlanId: plan.id },
            order: { version: 'DESC' },
        });
        if (latest) {
            latest.approvalStatus =
                decision === 'approved'
                    ? 'approved'
                    : decision === 'rejected'
                        ? 'rejected'
                        : 'pending';
            await this.revisions.save(latest);
        }
        return result;
    }
    async listRevisions(id, user) {
        await this.getOne(id, user);
        return this.revisions.find({
            where: { testPlanId: id },
            order: { version: 'DESC' },
        });
    }
    async getRevision(id, version, user) {
        await this.getOne(id, user);
        const rev = await this.revisions.findOne({
            where: { testPlanId: id, version },
        });
        if (!rev) {
            throw new errors_1.NotFoundAppException(`Revision v${version} of plan ${id} not found`);
        }
        return rev;
    }
    async compareRevisions(id, fromVersion, toVersion, user) {
        const [from, to] = await Promise.all([
            this.getRevision(id, fromVersion, user),
            this.getRevision(id, toVersion, user),
        ]);
        const keys = new Set([
            ...Object.keys(from.sections || {}),
            ...Object.keys(to.sections || {}),
        ]);
        keys.delete('schema_version');
        const sections = [...keys].sort().map((section) => {
            const a = (from.sections || {})[section];
            const b = (to.sections || {})[section];
            const change = a === undefined
                ? 'added'
                : b === undefined
                    ? 'removed'
                    : JSON.stringify(a) === JSON.stringify(b)
                        ? 'unchanged'
                        : 'changed';
            return { section, change, from: a, to: b };
        });
        return { from, to, sections };
    }
    async restoreRevision(id, version, user, correlationId) {
        const plan = await this.getOne(id, user);
        const rev = await this.getRevision(id, version, user);
        plan.sections = rev.sections;
        plan.title = rev.title || plan.title;
        plan.contentHash = (0, hash_1.contentHash)(plan.sections);
        await this.saveRevision(plan, user, 'restored', `Restored from v${version}`);
        await this.approvals.onUpstreamModified('test_plan', id, user, correlationId);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'test_plan.restore_revision',
            resourceType: 'test_plan',
            resourceId: id,
            projectId: plan.projectId,
            correlationId,
            metadata: { restoredFrom: version, newVersion: plan.version },
        });
        return this.getOne(id, user);
    }
    async export(id, format, user) {
        const plan = await this.getOne(id, user);
        const base = `test-plan-${plan.id}`;
        if (format === 'json') {
            return {
                contentType: 'application/json',
                filename: `${base}.json`,
                body: JSON.stringify({ id: plan.id, title: plan.title, version: plan.version, sections: plan.sections }, null, 2),
            };
        }
        const md = renderTestPlanMarkdown(plan.title, plan.sections);
        if (format === 'pdf') {
            try {
                const { pdfBase64 } = await this.engine.renderPdf(markdownToPrintableHtml(plan.title, md));
                return {
                    contentType: 'application/pdf',
                    filename: `${base}.pdf`,
                    body: Buffer.from(pdfBase64, 'base64'),
                };
            }
            catch {
                return { contentType: 'text/markdown', filename: `${base}.md`, body: md };
            }
        }
        return { contentType: 'text/markdown', filename: `${base}.md`, body: md };
    }
};
exports.TestPlansService = TestPlansService;
exports.TestPlansService = TestPlansService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.TestPlan)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.TestPlanRevision)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.Requirement)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.Analysis)),
    __param(4, (0, typeorm_1.InjectRepository)(entities_1.GenerationRun)),
    __param(5, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        events_service_1.EventsService,
        jobs_service_1.JobsService,
        approvals_service_1.ApprovalsService,
        requirement_derivation_service_1.RequirementDerivationService,
        engine_client_1.EngineClient])
], TestPlansService);
function markdownToPrintableHtml(title, md) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 22px; border-bottom: 2px solid #444; padding-bottom: 6px; }
  pre { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.55; }
</style></head><body><h1>${esc(title)}</h1><pre>${esc(md)}</pre></body></html>`;
}
function renderTestPlanMarkdown(title, sections) {
    const lines = [`# ${title}`, ''];
    for (const [key, value] of Object.entries(sections || {})) {
        if (key === 'schema_version')
            continue;
        const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`## ${heading}`);
        if (Array.isArray(value)) {
            for (const item of value)
                lines.push(`- ${String(item)}`);
        }
        else if (value && typeof value === 'object') {
            lines.push('```json', JSON.stringify(value, null, 2), '```');
        }
        else {
            lines.push(String(value ?? ''));
        }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=test-plans.service.js.map