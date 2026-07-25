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
var AuditService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const redact_1 = require("../../common/redact");
let AuditService = AuditService_1 = class AuditService {
    constructor(repo) {
        this.repo = repo;
        this.logger = new common_1.Logger(AuditService_1.name);
    }
    async record(input) {
        const event = this.repo.create({
            actor: input.actor || 'system',
            actorId: input.actorId ?? null,
            action: input.action,
            resourceType: input.resourceType || '',
            resourceId: input.resourceId || '',
            projectId: input.projectId ?? null,
            result: input.result || 'success',
            correlationId: input.correlationId || '',
            metadata: input.metadata
                ? (0, redact_1.redact)(input.metadata)
                : null,
        });
        const saved = await this.repo.save(event);
        this.logger.debug(`audit ${saved.action} ${saved.resourceType}:${saved.resourceId} → ${saved.result}`);
        return saved;
    }
    async query(filter) {
        const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
        if (filter.actor)
            qb.andWhere('a.actor = :actor', { actor: filter.actor });
        if (filter.action)
            qb.andWhere('a.action = :action', { action: filter.action });
        if (filter.resourceType)
            qb.andWhere('a.resource_type = :rt', { rt: filter.resourceType });
        if (filter.resourceId)
            qb.andWhere('a.resource_id = :rid', { rid: filter.resourceId });
        if (filter.projectId)
            qb.andWhere('a.project_id = :pid', { pid: filter.projectId });
        if (filter.from)
            qb.andWhere('a.created_at >= :from', { from: filter.from });
        if (filter.to)
            qb.andWhere('a.created_at <= :to', { to: filter.to });
        qb.take(Math.min(filter.limit ?? 100, 500)).skip(filter.offset ?? 0);
        const [items, total] = await qb.getManyAndCount();
        return { items, total };
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = AuditService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.AuditEvent)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], AuditService);
//# sourceMappingURL=audit.service.js.map