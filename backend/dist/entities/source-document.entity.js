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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceDocument = void 0;
const typeorm_1 = require("typeorm");
let SourceDocument = class SourceDocument {
};
exports.SourceDocument = SourceDocument;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], SourceDocument.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "filename", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'user_story' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "category", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'mime_type', default: '' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "mimeType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'size_bytes', default: 0 }),
    __metadata("design:type", Number)
], SourceDocument.prototype, "sizeBytes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'parse_status', default: 'pending' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "parseStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "message", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'storage_path', default: '' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "storagePath", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], SourceDocument.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'uploaded_by', nullable: true }),
    __metadata("design:type", Object)
], SourceDocument.prototype, "uploadedBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], SourceDocument.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], SourceDocument.prototype, "updatedAt", void 0);
exports.SourceDocument = SourceDocument = __decorate([
    (0, typeorm_1.Entity)('source_documents')
], SourceDocument);
//# sourceMappingURL=source-document.entity.js.map