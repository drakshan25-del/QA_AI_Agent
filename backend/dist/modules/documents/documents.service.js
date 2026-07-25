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
var DocumentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const fs_1 = require("fs");
const path_1 = require("path");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const hash_1 = require("../../common/hash");
const audit_service_1 = require("../audit/audit.service");
const membership_service_1 = require("../../common/access/membership.service");
const engine_client_1 = require("../../engine/engine.client");
const file_validation_1 = require("./file-validation");
let DocumentsService = DocumentsService_1 = class DocumentsService {
    constructor(documents, segments, membership, audit, engine, config) {
        this.documents = documents;
        this.segments = segments;
        this.membership = membership;
        this.audit = audit;
        this.engine = engine;
        this.config = config;
        this.logger = new common_1.Logger(DocumentsService_1.name);
    }
    get maxBytes() {
        return this.config.get('maxUploadBytes');
    }
    get uploadDir() {
        return this.config.get('uploadDir');
    }
    async upload(projectId, files, categories, user, correlationId) {
        await this.membership.ensureMember(projectId, user);
        const results = [];
        const toParse = [];
        files.forEach((file, i) => {
            const category = categories[i] || 'user_story';
            const v = (0, file_validation_1.validateUpload)(file, this.maxBytes);
            if (!v.ok) {
                results[i] = {
                    filename: file.originalname,
                    category,
                    status: 'rejected',
                    reason: v.reason,
                };
                void this.audit.record({
                    actor: user.email,
                    actorId: user.id,
                    action: 'document.upload.rejected',
                    resourceType: 'document',
                    projectId,
                    result: 'failure',
                    correlationId,
                    metadata: { filename: file.originalname, reason: v.reason },
                });
            }
            else {
                toParse.push({ index: i, file, category });
            }
        });
        if (toParse.length) {
            const parsed = await this.engine.parse(toParse.map((t) => ({
                filename: t.file.originalname,
                category: t.category,
                contentBase64: t.file.buffer.toString('base64'),
            })), correlationId);
            for (let k = 0; k < toParse.length; k++) {
                const { index, file, category } = toParse[k];
                const doc = parsed.documents[k];
                const hash = (0, hash_1.contentHash)(file.buffer);
                const storagePath = await this.persistFile(projectId, file);
                const entity = this.documents.create({
                    projectId,
                    filename: file.originalname,
                    category,
                    kind: doc?.kind || '',
                    mimeType: file.mimetype,
                    sizeBytes: file.size,
                    parseStatus: doc?.parse_status || 'parsed',
                    message: doc?.message || '',
                    storagePath,
                    contentHash: hash,
                    uploadedBy: user.id,
                });
                const savedDoc = await this.documents.save(entity);
                const segs = (doc?.segments || []).map((s, seq) => this.segments.create({
                    documentId: savedDoc.id,
                    sequence: seq,
                    pageOrSheet: s.page_or_sheet || '',
                    rowOrSection: s.row_or_section || '',
                    content: s.content || '',
                    metadata: s.metadata || null,
                    inclusionStatus: s.inclusion_status || 'included',
                }));
                if (segs.length)
                    await this.segments.save(segs);
                await this.audit.record({
                    actor: user.email,
                    actorId: user.id,
                    action: 'document.upload',
                    resourceType: 'document',
                    resourceId: savedDoc.id,
                    projectId,
                    correlationId,
                    metadata: {
                        filename: file.originalname,
                        category,
                        parseStatus: savedDoc.parseStatus,
                        segments: segs.length,
                    },
                });
                results[index] = {
                    filename: file.originalname,
                    category,
                    status: 'accepted',
                    documentId: savedDoc.id,
                    parseStatus: savedDoc.parseStatus,
                    segments: segs.length,
                };
            }
        }
        return results;
    }
    async persistFile(projectId, file) {
        try {
            const dir = (0, path_1.join)(this.uploadDir, 'documents', projectId);
            await fs_1.promises.mkdir(dir, { recursive: true });
            const safe = `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
            const path = (0, path_1.join)(dir, safe);
            await fs_1.promises.writeFile(path, file.buffer);
            return path;
        }
        catch (err) {
            this.logger.warn(`could not persist upload to disk: ${err.message}`);
            return '';
        }
    }
    async listByProject(projectId, user) {
        await this.membership.ensureMember(projectId, user);
        return this.documents.find({
            where: { projectId },
            order: { createdAt: 'DESC' },
        });
    }
    async getOne(id, user) {
        const doc = await this.documents.findOne({ where: { id } });
        if (!doc)
            throw new errors_1.NotFoundAppException(`Document ${id} not found`);
        await this.membership.ensureMember(doc.projectId, user);
        return doc;
    }
    async preview(id, user) {
        const doc = await this.getOne(id, user);
        const segments = await this.segments.find({
            where: { documentId: id },
            order: { sequence: 'ASC' },
        });
        return { document: doc, segments };
    }
    async updateSegments(id, updates, user, correlationId) {
        const doc = await this.getOne(id, user);
        for (const u of updates) {
            await this.segments.update({ id: u.segmentId, documentId: id }, { inclusionStatus: u.inclusionStatus });
        }
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'document.segments.update',
            resourceType: 'document',
            resourceId: id,
            projectId: doc.projectId,
            correlationId,
            metadata: { count: updates.length },
        });
        return this.segments.find({
            where: { documentId: id },
            order: { sequence: 'ASC' },
        });
    }
    async remove(id, user, correlationId) {
        const doc = await this.getOne(id, user);
        await this.segments.delete({ documentId: id });
        await this.documents.delete({ id });
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'document.delete',
            resourceType: 'document',
            resourceId: id,
            projectId: doc.projectId,
            correlationId,
        });
    }
};
exports.DocumentsService = DocumentsService;
exports.DocumentsService = DocumentsService = DocumentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.SourceDocument)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.DocumentSegment)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        engine_client_1.EngineClient,
        config_1.ConfigService])
], DocumentsService);
//# sourceMappingURL=documents.service.js.map