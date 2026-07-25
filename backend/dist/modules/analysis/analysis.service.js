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
exports.AnalysisService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const hash_1 = require("../../common/hash");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
const jobs_service_1 = require("../jobs/jobs.service");
const membership_service_1 = require("../../common/access/membership.service");
const requirement_derivation_service_1 = require("../requirements/requirement-derivation.service");
const engine_client_1 = require("../../engine/engine.client");
let AnalysisService = class AnalysisService {
    constructor(analyses, requirements, runs, projects, membership, audit, events, jobs, derivation, engine) {
        this.analyses = analyses;
        this.requirements = requirements;
        this.runs = runs;
        this.projects = projects;
        this.membership = membership;
        this.audit = audit;
        this.events = events;
        this.jobs = jobs;
        this.derivation = derivation;
        this.engine = engine;
        this.jobs.registerRetryHandler('analysis', (original, user, correlationId) => this.createJob(original.projectId, {
            requirementIds: original.inputRefs?.requirementIds ?? undefined,
            documentIds: original.inputRefs?.documentIds ?? undefined,
        }, user, correlationId));
    }
    async createJob(projectId, dto, user, correlationId, idempotencyKey) {
        await this.membership.ensureMember(projectId, user);
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        const requirements = await this.derivation.resolveGenerationScope(projectId, dto.requirementIds, dto.documentIds, user, correlationId);
        if (!requirements.length) {
            throw new errors_1.ValidationFailedException('No requirements to analyse. Add requirements or upload documents first.');
        }
        const job = await this.jobs.create({
            projectId,
            type: 'analysis',
            correlationId,
            idempotencyKey,
            inputRefs: {
                requirementIds: requirements.map((r) => r.id),
                documentIds: dto.documentIds ?? [],
            },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'analysis.generate',
            resourceType: 'job',
            resourceId: job.id,
            projectId,
            correlationId,
            metadata: { requirements: requirements.length },
        });
        this.jobs.dispatch(job, async (j, ctx) => {
            const run = await this.runs.save(this.runs.create({
                projectId,
                kind: 'analysis',
                jobId: job.id,
                inputRefs: { requirementIds: requirements.map((r) => r.id) },
                model: project.llmModel,
                temperature: project.llmTemperature,
                status: 'completed',
            }));
            await ctx.log({
                stage: 'document parsing',
                message: `Analysing ${requirements.length} requirement(s) with ${project.llmModel || 'the default model'}`,
                progress: 8,
            });
            const analysisIds = [];
            let index = 0;
            for (const req of requirements) {
                await ctx.checkpoint();
                index += 1;
                await ctx.log({
                    stage: 'requirement analysis',
                    message: `Requirement ${index}/${requirements.length}: "${req.title || req.id}" — extracting actors, flows, rules, risks and gaps`,
                    progress: 8 + Math.round(((index - 1) / requirements.length) * 84),
                });
                const output = await this.engine.analyse({
                    requirementId: req.id,
                    text: req.text,
                    acceptanceCriteria: req.acceptanceCriteria ?? [],
                    model: project.llmModel || undefined,
                    temperature: project.llmTemperature,
                }, correlationId, `${idempotencyKey || job.id}:${req.id}`);
                const risk = output.risk || {};
                const saved = await this.analyses.save(this.analyses.create({
                    projectId,
                    requirementId: req.id,
                    generationRunId: run.id,
                    schemaVersion: output.schema_version || 'v1',
                    contentHash: (0, hash_1.contentHash)(output),
                    riskScore: risk.score ?? 5,
                    output,
                    model: project.llmModel,
                    temperature: project.llmTemperature,
                    createdBy: user.id,
                }));
                analysisIds.push(saved.id);
                await ctx.log({
                    stage: 'requirement analysis',
                    severity: 'success',
                    message: `Requirement ${index}/${requirements.length}: analysis stored (risk score ${saved.riskScore}/10)`,
                    progress: 8 + Math.round((index / requirements.length) * 84),
                });
                this.events.emit({
                    type: 'analysis.ready',
                    projectId,
                    jobId: job.id,
                    correlationId,
                    payload: {
                        analysisId: saved.id,
                        requirementId: req.id,
                        riskScore: saved.riskScore,
                    },
                });
            }
            return {
                resultRefs: { analysisIds, generationRunId: run.id },
                readyEvent: {
                    type: 'analysis.ready',
                    payload: { analysisIds, count: analysisIds.length },
                },
            };
        });
        return { jobId: job.id, status: job.status, requirements: requirements.length };
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        return this.analyses.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
        });
    }
    async getOne(id, user) {
        const a = await this.analyses.findOne({ where: { id } });
        if (!a)
            throw new errors_1.NotFoundAppException(`Analysis ${id} not found`);
        await this.membership.ensureMember(a.projectId, user);
        return a;
    }
};
exports.AnalysisService = AnalysisService;
exports.AnalysisService = AnalysisService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Analysis)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.Requirement)),
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
        requirement_derivation_service_1.RequirementDerivationService,
        engine_client_1.EngineClient])
], AnalysisService);
//# sourceMappingURL=analysis.service.js.map