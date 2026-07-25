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
exports.RequirementsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const hash_1 = require("../../common/hash");
const audit_service_1 = require("../audit/audit.service");
const entities_2 = require("../../entities");
const membership_service_1 = require("../../common/access/membership.service");
let RequirementsService = class RequirementsService {
    constructor(requirements, auditEvents, membership, audit) {
        this.requirements = requirements;
        this.auditEvents = auditEvents;
        this.membership = membership;
        this.audit = audit;
    }
    async create(projectId, dto, user, correlationId) {
        await this.membership.ensureMember(projectId, user);
        const entity = this.requirements.create({
            projectId,
            source: dto.source || 'manual',
            version: 1,
            title: dto.title || '',
            text: dto.text,
            acceptanceCriteria: dto.acceptanceCriteria || [],
            status: 'draft',
            sourceDocumentId: dto.sourceDocumentId || null,
            contentHash: (0, hash_1.contentHash)({
                text: dto.text,
                ac: dto.acceptanceCriteria || [],
            }),
            createdBy: user.id,
        });
        const saved = await this.requirements.save(entity);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'requirement.create',
            resourceType: 'requirement',
            resourceId: saved.id,
            projectId,
            correlationId,
            metadata: { version: saved.version, source: saved.source },
        });
        return saved;
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        return this.requirements.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
        });
    }
    async getOne(id, user) {
        const req = await this.requirements.findOne({ where: { id } });
        if (!req)
            throw new errors_1.NotFoundAppException(`Requirement ${id} not found`);
        await this.membership.ensureMember(req.projectId, user);
        return req;
    }
    async history(id, user) {
        await this.getOne(id, user);
        return this.auditEvents.find({
            where: { resourceType: 'requirement', resourceId: id },
            order: { createdAt: 'DESC' },
        });
    }
    async versions(id, user) {
        const req = await this.getOne(id, user);
        return [
            {
                version: req.version,
                contentHash: req.contentHash,
                createdAt: req.updatedAt,
            },
        ];
    }
};
exports.RequirementsService = RequirementsService;
exports.RequirementsService = RequirementsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Requirement)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_2.AuditEvent)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService])
], RequirementsService);
//# sourceMappingURL=requirements.service.js.map