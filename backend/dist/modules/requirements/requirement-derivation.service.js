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
var RequirementDerivationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirementDerivationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const hash_1 = require("../../common/hash");
const audit_service_1 = require("../audit/audit.service");
let RequirementDerivationService = RequirementDerivationService_1 = class RequirementDerivationService {
    constructor(requirements, documents, segments, audit) {
        this.requirements = requirements;
        this.documents = documents;
        this.segments = segments;
        this.audit = audit;
        this.logger = new common_1.Logger(RequirementDerivationService_1.name);
    }
    async deriveFromDocuments(projectId, documentIds, user, correlationId) {
        const docWhere = documentIds?.length
            ? { projectId, id: (0, typeorm_2.In)(documentIds) }
            : { projectId };
        const docs = await this.documents.find({ where: docWhere });
        if (!docs.length)
            return [];
        const existing = await this.requirements.find({ where: { projectId } });
        const byHash = new Map(existing.map((r) => [r.contentHash, r]));
        const derived = [];
        let created = 0;
        for (const doc of docs) {
            if (['error', 'scanned'].includes(doc.parseStatus))
                continue;
            const segs = await this.segments.find({
                where: { documentId: doc.id, inclusionStatus: 'included' },
                order: { sequence: 'ASC' },
            });
            for (const seg of segs) {
                const text = (seg.content || '').trim();
                if (!text)
                    continue;
                const hash = (0, hash_1.contentHash)({ text, ac: [] });
                const already = byHash.get(hash);
                if (already) {
                    derived.push(already);
                    continue;
                }
                const location = seg.rowOrSection || seg.pageOrSheet || `segment ${seg.sequence + 1}`;
                const saved = await this.requirements.save(this.requirements.create({
                    projectId,
                    source: 'document',
                    version: 1,
                    title: `${doc.filename} — ${location}`.slice(0, 250),
                    text,
                    acceptanceCriteria: [],
                    status: 'draft',
                    sourceDocumentId: doc.id,
                    contentHash: hash,
                    createdBy: user.id,
                }));
                byHash.set(hash, saved);
                derived.push(saved);
                created += 1;
                await this.audit.record({
                    actor: user.email,
                    actorId: user.id,
                    action: 'requirement.derive',
                    resourceType: 'requirement',
                    resourceId: saved.id,
                    projectId,
                    correlationId,
                    metadata: { documentId: doc.id, filename: doc.filename, location },
                });
            }
        }
        if (created) {
            this.logger.log(`derived ${created} requirement(s) from documents for project ${projectId}`);
        }
        return derived;
    }
    async resolveGenerationScope(projectId, requirementIds, documentIds, user, correlationId) {
        const derived = await this.deriveFromDocuments(projectId, documentIds, user, correlationId);
        const where = requirementIds?.length
            ? { projectId, id: (0, typeorm_2.In)(requirementIds) }
            : { projectId };
        const explicit = await this.requirements.find({ where });
        const seen = new Set(explicit.map((r) => r.id));
        return [...explicit, ...derived.filter((r) => !seen.has(r.id))];
    }
};
exports.RequirementDerivationService = RequirementDerivationService;
exports.RequirementDerivationService = RequirementDerivationService = RequirementDerivationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Requirement)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.SourceDocument)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.DocumentSegment)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        audit_service_1.AuditService])
], RequirementDerivationService);
//# sourceMappingURL=requirement-derivation.service.js.map