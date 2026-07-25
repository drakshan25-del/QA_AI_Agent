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
var ApprovalsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const events_service_1 = require("../events/events.service");
let ApprovalsService = ApprovalsService_1 = class ApprovalsService {
    constructor(approvals, testPlans, testCases, artifacts, audit, events) {
        this.approvals = approvals;
        this.testPlans = testPlans;
        this.testCases = testCases;
        this.artifacts = artifacts;
        this.audit = audit;
        this.events = events;
        this.logger = new common_1.Logger(ApprovalsService_1.name);
    }
    repoFor(type) {
        switch (type) {
            case 'test_plan':
                return this.testPlans;
            case 'test_case':
                return this.testCases;
            case 'automation':
                return this.artifacts;
            default:
                throw new errors_1.ConflictAppException(`Approval type ${type} is record-only; use the dedicated endpoint.`, 'unsupported_approval_type');
        }
    }
    async recordStandalone(type, resourceId, projectId, decision, comment, user, correlationId) {
        const record = await this.approvals.save(this.approvals.create({
            projectId,
            resourceType: type,
            resourceId,
            resourceVersion: 1,
            decision,
            comment: comment || '',
            invalidated: false,
            actorId: user.id,
            actor: user.email,
        }));
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: `approval.${decision}`,
            resourceType: type,
            resourceId,
            projectId,
            correlationId,
            metadata: { decision },
        });
        this.events.emit({
            type: 'approval.updated',
            projectId,
            correlationId,
            payload: { resourceType: type, resourceId, decision },
        });
        return record;
    }
    async latestStandalone(type, resourceId) {
        return this.approvals.findOne({
            where: { resourceType: type, resourceId },
            order: { createdAt: 'DESC' },
        });
    }
    async load(type, id) {
        const entity = (await this.repoFor(type).findOne({
            where: { id },
        }));
        if (!entity) {
            throw new errors_1.NotFoundAppException(`${type} ${id} not found`);
        }
        return entity;
    }
    async decide(type, id, decision, comment, user, correlationId) {
        const entity = await this.load(type, id);
        const nextStatus = decision === 'approved'
            ? 'approved'
            : decision === 'rejected'
                ? 'rejected'
                : 'pending';
        entity.approvalStatus = nextStatus;
        entity.approvalInvalidated = false;
        await this.repoFor(type).save(entity);
        const record = this.approvals.create({
            projectId: entity.projectId,
            resourceType: type,
            resourceId: id,
            resourceVersion: entity.version,
            decision,
            comment: comment || '',
            invalidated: false,
            actorId: user.id,
            actor: user.email,
        });
        await this.approvals.save(record);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: `approval.${decision}`,
            resourceType: type,
            resourceId: id,
            projectId: entity.projectId,
            correlationId,
            metadata: { decision, version: entity.version },
        });
        this.events.emit({
            type: 'approval.updated',
            projectId: entity.projectId,
            correlationId,
            payload: {
                resourceType: type,
                resourceId: id,
                decision,
                approvalStatus: nextStatus,
                version: entity.version,
            },
        });
        if (decision !== 'approved') {
            await this.invalidateDownstream(type, id, entity.projectId, correlationId);
        }
        return { id, approvalStatus: nextStatus, version: entity.version };
    }
    async decideBulk(type, ids, decision, comment, user, correlationId) {
        const out = [];
        for (const id of ids) {
            try {
                out.push(await this.decide(type, id, decision, comment, user, correlationId));
            }
            catch (err) {
                out.push({ id, error: err.message });
            }
        }
        return out;
    }
    async ensureApproved(type, id) {
        const entity = await this.load(type, id);
        if (entity.approvalStatus !== 'approved' || entity.approvalInvalidated) {
            throw new errors_1.ConflictAppException(`${type} ${id} is not approved (status=${entity.approvalStatus}` +
                `${entity.approvalInvalidated ? ', invalidated by upstream change' : ''}). ` +
                `Approval is required before this action.`, 'approval_required', { resourceType: type, resourceId: id, approvalStatus: entity.approvalStatus });
        }
        return entity;
    }
    async onUpstreamModified(type, id, user, correlationId) {
        const entity = await this.load(type, id);
        if (entity.approvalStatus === 'approved') {
            entity.approvalStatus = 'pending';
            entity.approvalInvalidated = true;
            await this.repoFor(type).save(entity);
            await this.markApprovalsInvalidated(type, id);
            this.emitInvalidated(type, id, entity.projectId, correlationId);
        }
        await this.invalidateDownstream(type, id, entity.projectId, correlationId);
    }
    async invalidateDownstream(type, id, projectId, correlationId) {
        if (type === 'test_case') {
            const arts = await this.artifacts.find({
                where: { status: 'active', projectId },
            });
            const affected = arts.filter((a) => (a.testCaseIds ?? []).includes(id));
            for (const a of affected) {
                if (a.approvalStatus === 'approved' || a.validationStatus === 'passed') {
                    a.approvalStatus = 'pending';
                    a.approvalInvalidated = true;
                    a.validationStatus = 'pending';
                    await this.artifacts.save(a);
                    await this.markApprovalsInvalidated('automation', a.id);
                    this.emitInvalidated('automation', a.id, a.projectId, correlationId);
                }
            }
        }
    }
    async markApprovalsInvalidated(type, id) {
        await this.approvals.update({ resourceType: type, resourceId: id, decision: 'approved' }, { invalidated: true });
    }
    emitInvalidated(type, id, projectId, correlationId) {
        this.events.emit({
            type: 'approval.updated',
            projectId,
            correlationId,
            payload: {
                resourceType: type,
                resourceId: id,
                approvalStatus: 'pending',
                invalidated: true,
            },
        });
    }
    async history(resourceId) {
        return this.approvals.find({
            where: { resourceId },
            order: { createdAt: 'DESC' },
        });
    }
    async listByIds(ids) {
        if (!ids.length)
            return [];
        return this.approvals.find({ where: { resourceId: (0, typeorm_2.In)(ids) } });
    }
};
exports.ApprovalsService = ApprovalsService;
exports.ApprovalsService = ApprovalsService = ApprovalsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Approval)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.TestPlan)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.TestCase)),
    __param(3, (0, typeorm_1.InjectRepository)(entities_1.GeneratedArtifact)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        audit_service_1.AuditService,
        events_service_1.EventsService])
], ApprovalsService);
//# sourceMappingURL=approvals.service.js.map