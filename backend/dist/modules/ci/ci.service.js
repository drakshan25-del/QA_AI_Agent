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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var CiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CiService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const axios_1 = __importDefault(require("axios"));
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
const membership_service_1 = require("../../common/access/membership.service");
let CiService = CiService_1 = class CiService {
    constructor(projects, artifacts, runs, membership, audit, events, config) {
        this.projects = projects;
        this.artifacts = artifacts;
        this.runs = runs;
        this.membership = membership;
        this.audit = audit;
        this.events = events;
        this.config = config;
        this.logger = new common_1.Logger(CiService_1.name);
    }
    get githubToken() {
        return this.config.get('githubToken') || '';
    }
    async dispatch(dto, user, correlationId) {
        await this.membership.ensureMember(dto.projectId, user);
        const project = await this.projects.findOne({
            where: { id: dto.projectId },
        });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${dto.projectId} not found`);
        const ready = await this.artifacts.count({
            where: {
                projectId: dto.projectId,
                status: 'active',
                approvalStatus: 'approved',
                validationStatus: 'passed',
            },
        });
        if (ready === 0) {
            await this.audit.record({
                actor: user.email,
                actorId: user.id,
                action: 'ci.dispatch',
                resourceType: 'project',
                resourceId: dto.projectId,
                projectId: dto.projectId,
                result: 'denied',
                correlationId,
                metadata: { reason: 'no_approved_validated_automation' },
            });
            throw new errors_1.ConflictAppException('Cannot dispatch CI: no approved + validated automation exists for this project.', 'approval_required');
        }
        const run = await this.runs.save(this.runs.create({
            projectId: dto.projectId,
            mode: 'ci',
            status: 'running',
            environment: 'ci',
            browser: 'chromium',
            correlationId: correlationId || '',
            startedAt: new Date(),
            createdBy: user.id,
        }));
        let mode = 'simulated';
        let ciUrl = '';
        if (this.githubToken && project.repository.includes('/')) {
            try {
                const workflow = dto.workflow || 'qa.yml';
                const ref = dto.ref || 'main';
                await axios_1.default.post(`https://api.github.com/repos/${project.repository}/actions/workflows/${workflow}/dispatches`, { ref }, {
                    headers: {
                        Authorization: `Bearer ${this.githubToken}`,
                        Accept: 'application/vnd.github+json',
                    },
                    timeout: 15_000,
                });
                mode = 'dispatched';
                ciUrl = `https://github.com/${project.repository}/actions`;
            }
            catch (err) {
                this.logger.warn(`GitHub dispatch failed: ${err.message}`);
                mode = 'dispatch-failed';
            }
        }
        run.ciRunId = run.id;
        run.ciUrl = ciUrl;
        await this.runs.save(run);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'ci.dispatch',
            resourceType: 'project',
            resourceId: dto.projectId,
            projectId: dto.projectId,
            correlationId,
            metadata: { ciRunId: run.id, mode },
        });
        this.events.emit({
            type: 'ci.status',
            projectId: dto.projectId,
            correlationId,
            payload: { ciRunId: run.id, status: 'running', mode },
        });
        return { ciRunId: run.id, status: 'running', mode, ciUrl };
    }
    async getRun(id, user) {
        const run = await this.runs.findOne({ where: { id } });
        if (!run)
            throw new errors_1.NotFoundAppException(`CI run ${id} not found`);
        await this.membership.ensureMember(run.projectId, user);
        return Object.assign(run, { ciStatus: ciStateOf(run.status) });
    }
    async listRuns(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        const runs = await this.runs.find({
            where: { projectId, mode: 'ci' },
            order: { createdAt: 'DESC' },
            take: 50,
        });
        return runs.map((r) => Object.assign(r, { ciStatus: ciStateOf(r.status) }));
    }
    async importRun(id, body, user, correlationId) {
        const run = await this.getRun(id, user);
        run.metrics = body.metrics || run.metrics || {};
        run.status = normaliseCiConclusion(body.status);
        run.finishedAt = new Date();
        const saved = await this.runs.save(run);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'ci.import',
            resourceType: 'execution',
            resourceId: id,
            projectId: run.projectId,
            correlationId,
            metadata: { status: run.status, ciStatus: ciStateOf(run.status) },
        });
        this.events.emit({
            type: 'ci.status',
            projectId: run.projectId,
            correlationId,
            payload: { ciRunId: id, status: run.status, ciStatus: ciStateOf(run.status) },
        });
        return Object.assign(saved, { ciStatus: ciStateOf(saved.status) });
    }
};
exports.CiService = CiService;
exports.CiService = CiService = CiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.GeneratedArtifact)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.ExecutionRun)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        events_service_1.EventsService,
        config_1.ConfigService])
], CiService);
function ciStateOf(status) {
    switch (status) {
        case 'queued':
            return 'queued';
        case 'preparing':
        case 'running':
        case 'stopping':
            return 'in_progress';
        case 'passed':
        case 'completed':
            return 'successful';
        case 'failed':
        case 'partially_passed':
        case 'error':
        case 'timed_out':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'not_triggered';
    }
}
function normaliseCiConclusion(status) {
    switch ((status || '').toLowerCase()) {
        case 'success':
        case 'passed':
        case 'completed':
            return 'passed';
        case 'failure':
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
        case 'timed_out':
            return 'timed_out';
        default:
            return 'passed';
    }
}
//# sourceMappingURL=ci.service.js.map