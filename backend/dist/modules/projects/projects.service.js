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
exports.ProjectsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const membership_service_1 = require("../../common/access/membership.service");
let ProjectsService = class ProjectsService {
    constructor(projects, members, membership, audit, dataSource) {
        this.projects = projects;
        this.members = members;
        this.membership = membership;
        this.audit = audit;
        this.dataSource = dataSource;
    }
    async create(dto, user, correlationId) {
        const project = this.projects.create({
            name: dto.name,
            description: dto.description ?? '',
            baseUrl: dto.baseUrl ?? '',
            allowedDomains: dto.allowedDomains ?? 'localhost,127.0.0.1',
            repository: dto.repository ?? '',
            environment: dto.environment ?? 'test',
            status: 'active',
            llmModel: dto.llmModel ?? '',
            llmTemperature: dto.llmTemperature ?? 0.1,
            runner: dto.runner ?? 'pytest',
            tcZeroPad: dto.tcZeroPad ?? 0,
            createdBy: user.id,
        });
        const saved = await this.projects.save(project);
        await this.membership.addMember(saved.id, user.id, user.role);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'project.create',
            resourceType: 'project',
            resourceId: saved.id,
            projectId: saved.id,
            correlationId,
            metadata: { name: saved.name },
        });
        return saved;
    }
    async findAllForUser(user) {
        if (user.role === 'admin') {
            return this.projects.find({ order: { createdAt: 'DESC' } });
        }
        const memberships = await this.members.find({
            where: { userId: user.id },
        });
        const ids = memberships.map((m) => m.projectId);
        if (!ids.length)
            return [];
        return this.projects.find({
            where: { id: (0, typeorm_2.In)(ids) },
            order: { createdAt: 'DESC' },
        });
    }
    async findOne(id, user) {
        await this.membership.ensureMember(id, user);
        const project = await this.projects.findOne({ where: { id } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${id} not found`);
        return project;
    }
    async findOneWithSummary(id, user) {
        const project = await this.findOne(id, user);
        const workflowSummary = await this.workflowSummary(id);
        return Object.assign(project, { workflowSummary });
    }
    async workflowSummary(projectId) {
        const count = (entity, where = {}) => this.dataSource.getRepository(entity).count({
            where: { projectId, ...where },
        });
        const [documents, requirements, analyses, testPlans, approvedPlans, testCases, approvedCases, artifacts, executions, pendingApprovals,] = await Promise.all([
            count(entities_1.SourceDocument),
            count(entities_1.Requirement),
            count(entities_1.Analysis),
            count(entities_1.TestPlan),
            count(entities_1.TestPlan, { approvalStatus: 'approved' }),
            count(entities_1.TestCase),
            count(entities_1.TestCase, { approvalStatus: 'approved' }),
            count(entities_1.GeneratedArtifact),
            count(entities_1.ExecutionRun),
            this.pendingApprovalsCount(projectId),
        ]);
        return {
            documents,
            requirements,
            analyses,
            testPlans,
            approvedPlans,
            testCases,
            approvedCases,
            artifacts,
            executions,
            pendingApprovals,
        };
    }
    async pendingApprovalsCount(projectId) {
        const count = (entity, where = {}) => this.dataSource.getRepository(entity).count({
            where: { projectId, ...where },
        });
        const [plans, cases, artifacts] = await Promise.all([
            count(entities_1.TestPlan, { approvalStatus: 'pending' }),
            count(entities_1.TestCase, { approvalStatus: 'pending' }),
            count(entities_1.GeneratedArtifact, { approvalStatus: 'pending', status: 'active' }),
        ]);
        return plans + cases + artifacts;
    }
    async dashboard(id, user) {
        await this.findOne(id, user);
        const summary = await this.workflowSummary(id);
        const runs = await this.dataSource.getRepository(entities_1.ExecutionRun).find({
            where: { projectId: id },
            order: { createdAt: 'DESC' },
            take: 10,
        });
        const results = await this.dataSource
            .getRepository(entities_1.TestResult)
            .createQueryBuilder('r')
            .innerJoin(entities_1.ExecutionRun, 'e', 'e.id = r.execution_run_id')
            .where('e.project_id = :id', { id })
            .getMany();
        const passed = results.filter((r) => r.outcome === 'passed').length;
        const failed = results.filter((r) => r.outcome === 'failed').length;
        const findings = await this.dataSource
            .getRepository(entities_1.Finding)
            .count({ where: { projectId: id } });
        const recentActivity = await this.dataSource.getRepository(entities_1.AuditEvent).find({
            where: { projectId: id },
            order: { createdAt: 'DESC' },
            take: 20,
        });
        const pendingApprovalItems = await this.pendingApprovalItems(id);
        return {
            workflowSummary: summary,
            pendingApprovals: pendingApprovalItems,
            recentRuns: runs.map((r) => ({
                id: r.id,
                status: r.status,
                browser: r.browser,
                headed: r.headed,
                mode: r.mode,
                runScope: r.runScope,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
                metrics: r.metrics,
            })),
            passRate: {
                total: results.length,
                passed,
                failed,
                percent: results.length
                    ? Math.round((passed / results.length) * 100)
                    : 0,
            },
            defects: findings,
            recentActivity,
        };
    }
    async pendingApprovalItems(projectId) {
        const where = {
            projectId,
            approvalStatus: 'pending',
        };
        const [plans, cases, artifacts] = await Promise.all([
            this.dataSource.getRepository(entities_1.TestPlan).find({ where, take: 10 }),
            this.dataSource.getRepository(entities_1.TestCase).find({ where, take: 10 }),
            this.dataSource.getRepository(entities_1.GeneratedArtifact).find({
                where: { ...where, status: 'active' },
                take: 10,
            }),
        ]);
        return [
            ...plans.map((p) => ({
                resourceType: 'test_plan',
                resourceId: p.id,
                title: p.title,
                version: p.version,
            })),
            ...cases.map((c) => ({
                resourceType: 'test_case',
                resourceId: c.id,
                title: `${c.humanId ? `${c.humanId} - ` : ''}${c.title}`,
                version: c.version,
            })),
            ...artifacts.map((a) => ({
                resourceType: 'automation',
                resourceId: a.id,
                title: a.path,
                version: a.version,
            })),
        ];
    }
    async update(id, dto, user, correlationId) {
        const project = await this.findOne(id, user);
        Object.assign(project, {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
            ...(dto.allowedDomains !== undefined
                ? { allowedDomains: dto.allowedDomains }
                : {}),
            ...(dto.repository !== undefined ? { repository: dto.repository } : {}),
            ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.llmModel !== undefined ? { llmModel: dto.llmModel } : {}),
            ...(dto.llmTemperature !== undefined
                ? { llmTemperature: dto.llmTemperature }
                : {}),
            ...(dto.runner !== undefined ? { runner: dto.runner } : {}),
            ...(dto.tcZeroPad !== undefined ? { tcZeroPad: dto.tcZeroPad } : {}),
        });
        const saved = await this.projects.save(project);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'project.update',
            resourceType: 'project',
            resourceId: id,
            projectId: id,
            correlationId,
            metadata: { changes: Object.keys(dto) },
        });
        return saved;
    }
    async exportProject(id, user) {
        const project = await this.findOne(id, user);
        const load = (entity) => this.dataSource.getRepository(entity).find({
            where: { projectId: id },
        });
        const [requirements, analyses, testPlans, testCases, artifacts, executions] = await Promise.all([
            load(entities_1.Requirement),
            load(entities_1.Analysis),
            load(entities_1.TestPlan),
            load(entities_1.TestCase),
            load(entities_1.GeneratedArtifact),
            load(entities_1.ExecutionRun),
        ]);
        return {
            project: {
                id: project.id,
                name: project.name,
                description: project.description,
                baseUrl: project.baseUrl,
                allowedDomains: project.allowedDomains,
                repository: project.repository,
                environment: project.environment,
                status: project.status,
                runner: project.runner,
                createdAt: project.createdAt,
            },
            requirements,
            analyses,
            testPlans,
            testCases,
            artifacts: artifacts.map((a) => ({
                ...a,
                content: undefined,
            })),
            executions,
            exportedAt: new Date().toISOString(),
        };
    }
    async metrics(id, user) {
        await this.findOne(id, user);
        const summary = await this.workflowSummary(id);
        const results = await this.dataSource
            .getRepository(entities_1.TestResult)
            .createQueryBuilder('r')
            .innerJoin(entities_1.ExecutionRun, 'e', 'e.id = r.execution_run_id')
            .where('e.project_id = :id', { id })
            .getMany();
        const passed = results.filter((r) => r.outcome === 'passed').length;
        const failed = results.filter((r) => r.outcome === 'failed').length;
        const total = results.length;
        return {
            ...summary,
            results: {
                total,
                passed,
                failed,
                passRate: total ? Math.round((passed / total) * 100) / 100 : 0,
            },
        };
    }
    async addMember(projectId, userId, projectRole, actor, correlationId) {
        await this.findOne(projectId, actor);
        const member = await this.membership.addMember(projectId, userId, projectRole);
        await this.audit.record({
            actor: actor.email,
            actorId: actor.id,
            action: 'project.member.add',
            resourceType: 'project',
            resourceId: projectId,
            projectId,
            correlationId,
            metadata: { userId, projectRole },
        });
        return member;
    }
};
exports.ProjectsService = ProjectsService;
exports.ProjectsService = ProjectsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.ProjectMember)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        typeorm_2.DataSource])
], ProjectsService);
//# sourceMappingURL=projects.service.js.map