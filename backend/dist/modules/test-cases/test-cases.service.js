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
var TestCasesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestCasesService = void 0;
exports.formatTestCaseId = formatTestCaseId;
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
const sequences_service_1 = require("../sequences/sequences.service");
const engine_client_1 = require("../../engine/engine.client");
function formatTestCaseId(seq, zeroPad = 0) {
    const n = zeroPad > 0 ? String(seq).padStart(zeroPad, '0') : String(seq);
    return `TC-${n}`;
}
let TestCasesService = TestCasesService_1 = class TestCasesService {
    constructor(cases, requirements, analyses, runs, projects, membership, audit, events, jobs, approvals, derivation, sequences, engine) {
        this.cases = cases;
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
        this.sequences = sequences;
        this.engine = engine;
        this.logger = new common_1.Logger(TestCasesService_1.name);
        this.jobs.registerRetryHandler('test_cases', (original, user, correlationId) => this.generate(original.projectId, {
            requirementIds: original.inputRefs?.requirementIds ?? undefined,
            minCases: original.inputRefs?.minCases ?? undefined,
        }, user, correlationId));
    }
    async onModuleInit() {
        try {
            const legacy = await this.cases.find({
                where: { seq: 0 },
                order: { createdAt: 'ASC' },
            });
            if (!legacy.length)
                return;
            const byProject = new Map();
            for (const tc of legacy) {
                const list = byProject.get(tc.projectId) ?? [];
                list.push(tc);
                byProject.set(tc.projectId, list);
            }
            for (const [projectId, list] of byProject) {
                const project = await this.projects.findOne({ where: { id: projectId } });
                const start = await this.sequences.next(projectId, 'test_case', list.length);
                list.forEach((tc, i) => {
                    tc.seq = start + i;
                    tc.humanId = formatTestCaseId(tc.seq, project?.tcZeroPad ?? 0);
                });
                await this.cases.save(list);
                this.logger.log(`Backfilled ${list.length} test-case IDs for project ${projectId}`);
            }
        }
        catch (err) {
            this.logger.warn(`test-case ID backfill skipped: ${err.message}`);
        }
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        await this.membership.ensureMember(projectId, user);
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        const requirements = await this.derivation.resolveGenerationScope(projectId, dto.requirementIds, undefined, user, correlationId);
        if (!requirements.length) {
            throw new errors_1.NotFoundAppException('No matching requirements found. Add requirements or upload documents first.');
        }
        const job = await this.jobs.create({
            projectId,
            type: 'test_cases',
            correlationId,
            idempotencyKey,
            inputRefs: {
                requirementIds: requirements.map((r) => r.id),
                minCases: dto.minCases,
            },
            createdBy: user.id,
        });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'test_cases.generate',
            resourceType: 'job',
            resourceId: job.id,
            projectId,
            correlationId,
        });
        this.jobs.dispatch(job, async (j, ctx) => {
            const run = await this.runs.save(this.runs.create({
                projectId,
                kind: 'test_cases',
                jobId: job.id,
                model: project.llmModel,
                temperature: project.llmTemperature,
                status: 'completed',
            }));
            await ctx.log({
                stage: 'scenario discovery',
                message: `Generating test cases for ${requirements.length} requirement(s) with ${project.llmModel || 'the default model'}`,
                progress: 8,
            });
            const caseIds = [];
            let index = 0;
            for (const req of requirements) {
                await ctx.checkpoint();
                index += 1;
                const progressBase = 8 + Math.round((index - 1) / requirements.length * 80);
                await ctx.log({
                    stage: 'scenario discovery',
                    message: `Requirement ${index}/${requirements.length}: "${req.title || req.id}" — discovering positive, negative and boundary scenarios`,
                    progress: progressBase,
                });
                const analysis = await this.analyses.findOne({
                    where: { projectId, requirementId: req.id },
                    order: { createdAt: 'DESC' },
                });
                const output = await this.engine.testCases({
                    requirement: {
                        id: req.id,
                        title: req.title,
                        text: req.text,
                        acceptance_criteria: req.acceptanceCriteria ?? [],
                    },
                    analysis: analysis?.output,
                    minCases: dto.minCases ?? 10,
                    model: project.llmModel || undefined,
                    temperature: project.llmTemperature,
                }, correlationId, `${idempotencyKey || job.id}:${req.id}`);
                const list = output.test_cases || [];
                await ctx.log({
                    stage: 'numbering',
                    message: `Requirement ${index}/${requirements.length}: assigning ${list.length} TC identifiers from the project sequence`,
                    progress: progressBase + Math.round(80 / requirements.length / 2),
                });
                const firstSeq = list.length
                    ? await this.sequences.next(projectId, 'test_case', list.length)
                    : 0;
                let offset = 0;
                for (const tc of list) {
                    const seq = firstSeq + offset;
                    offset += 1;
                    const saved = await this.cases.save(this.cases.create({
                        projectId,
                        generationRunId: run.id,
                        requirementIds: (tc.requirement_ids || [req.id]),
                        caseKey: tc.case_key || '',
                        seq,
                        humanId: formatTestCaseId(seq, project.tcZeroPad),
                        title: tc.title || 'Untitled',
                        objective: tc.objective || '',
                        category: tc.category || 'positive',
                        priority: tc.priority || 'medium',
                        preconditions: tc.preconditions || [],
                        testData: tc.test_data || {},
                        steps: tc.steps || [],
                        expectedResults: tc.expected_results || [],
                        automationSuitability: tc.automation_suitability || 'automatable',
                        source: 'ai',
                        approvalStatus: 'pending',
                        automationStatus: 'none',
                        version: 1,
                        contentHash: (0, hash_1.contentHash)(tc),
                        createdBy: user.id,
                    }));
                    caseIds.push(saved.id);
                }
                await ctx.log({
                    stage: 'persistence',
                    severity: 'success',
                    message: `Requirement ${index}/${requirements.length}: saved ${list.length} case(s) (${list.length ? `${formatTestCaseId(firstSeq, project.tcZeroPad)}…${formatTestCaseId(firstSeq + list.length - 1, project.tcZeroPad)}` : 'none'})`,
                    progress: 8 + Math.round(index / requirements.length * 80),
                });
            }
            this.events.emit({
                type: 'cases.ready',
                projectId,
                jobId: job.id,
                correlationId,
                payload: { testCaseIds: caseIds, count: caseIds.length },
            });
            return {
                resultRefs: { testCaseIds: caseIds, generationRunId: run.id },
                readyEvent: {
                    type: 'cases.ready',
                    payload: { testCaseIds: caseIds, count: caseIds.length },
                },
            };
        });
        return { jobId: job.id, status: job.status };
    }
    async list(projectId, filter, user) {
        await this.membership.ensureMember(projectId, user);
        const page = Math.max(filter.page ?? 1, 1);
        const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 200);
        const qb = this.cases
            .createQueryBuilder('t')
            .where('t.project_id = :projectId', { projectId });
        if (filter.source)
            qb.andWhere('t.source = :source', { source: filter.source });
        if (filter.priority)
            qb.andWhere('t.priority = :priority', { priority: filter.priority });
        if (filter.type)
            qb.andWhere('t.category = :type', { type: filter.type });
        if (filter.approval)
            qb.andWhere('t.approval_status = :approval', { approval: filter.approval });
        if (filter.automation)
            qb.andWhere('t.automation_status = :automation', {
                automation: filter.automation,
            });
        if (filter.q)
            qb.andWhere('(t.title LIKE :q OR t.objective LIKE :q OR t.human_id LIKE :q)', {
                q: `%${filter.q}%`,
            });
        qb.orderBy('t.seq', 'ASC')
            .addOrderBy('t.created_at', 'DESC')
            .skip((page - 1) * pageSize)
            .take(pageSize);
        const [items, total] = await qb.getManyAndCount();
        return {
            items: items.map((c) => Object.assign(c, { artefactState: (0, state_machines_1.deriveArtefactState)(c) })),
            total,
            page,
            pageSize,
        };
    }
    async getOne(id, user) {
        const tc = await this.cases.findOne({ where: { id } });
        if (!tc)
            throw new errors_1.NotFoundAppException(`Test case ${id} not found`);
        await this.membership.ensureMember(tc.projectId, user);
        return Object.assign(tc, { artefactState: (0, state_machines_1.deriveArtefactState)(tc) });
    }
    async update(id, dto, user, correlationId) {
        const tc = await this.getOne(id, user);
        Object.assign(tc, {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
            ...(dto.category !== undefined ? { category: dto.category } : {}),
            ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
            ...(dto.preconditions !== undefined
                ? { preconditions: dto.preconditions }
                : {}),
            ...(dto.steps !== undefined ? { steps: dto.steps } : {}),
            ...(dto.expectedResults !== undefined
                ? { expectedResults: dto.expectedResults }
                : {}),
            ...(dto.testData !== undefined ? { testData: dto.testData } : {}),
            ...(dto.automationSuitability !== undefined
                ? { automationSuitability: dto.automationSuitability }
                : {}),
            source: 'manual',
        });
        tc.version += 1;
        tc.contentHash = (0, hash_1.contentHash)({
            title: tc.title,
            steps: tc.steps,
            expected: tc.expectedResults,
        });
        await this.cases.save(tc);
        await this.approvals.onUpstreamModified('test_case', id, user, correlationId);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'test_case.update',
            resourceType: 'test_case',
            resourceId: id,
            projectId: tc.projectId,
            correlationId,
            metadata: { version: tc.version, humanId: tc.humanId },
        });
        return this.getOne(id, user);
    }
    async approve(ids, decision, comment, user, correlationId) {
        for (const id of ids)
            await this.getOne(id, user);
        return this.approvals.decideBulk('test_case', ids, decision, comment, user, correlationId);
    }
    async coverage(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        const [requirements, cases] = await Promise.all([
            this.requirements.find({ where: { projectId } }),
            this.cases.find({ where: { projectId } }),
        ]);
        const perRequirement = requirements.map((r) => {
            const covering = cases.filter((c) => (c.requirementIds ?? []).includes(r.id));
            return {
                requirementId: r.id,
                title: r.title,
                testCaseCount: covering.length,
                approvedCount: covering.filter((c) => c.approvalStatus === 'approved')
                    .length,
                covered: covering.length > 0,
            };
        });
        const covered = perRequirement.filter((r) => r.covered).length;
        return {
            totalRequirements: requirements.length,
            coveredRequirements: covered,
            coveragePercent: requirements.length
                ? Math.round((covered / requirements.length) * 100)
                : 0,
            totalTestCases: cases.length,
            perRequirement,
        };
    }
};
exports.TestCasesService = TestCasesService;
exports.TestCasesService = TestCasesService = TestCasesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.TestCase)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.Requirement)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.Analysis)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.GenerationRun)),
    __param(4, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
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
        sequences_service_1.SequencesService,
        engine_client_1.EngineClient])
], TestCasesService);
//# sourceMappingURL=test-cases.service.js.map