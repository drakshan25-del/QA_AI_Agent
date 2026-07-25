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
exports.GeneratedArtifact = void 0;
const typeorm_1 = require("typeorm");
let GeneratedArtifact = class GeneratedArtifact {
};
exports.GeneratedArtifact = GeneratedArtifact;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'generation_run_id', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "generationRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'test_case_ids', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "testCaseIds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "path", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'test_file' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "content", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "diff", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "traceability", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], GeneratedArtifact.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'active' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'superseded_by_id', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "supersededById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'validation_status', default: 'pending' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "validationStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'validation_report', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "validationReport", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'approval_status', default: 'pending' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "approvalStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', name: 'approval_invalidated', default: false }),
    __metadata("design:type", Boolean)
], GeneratedArtifact.prototype, "approvalInvalidated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'schema_version', default: 'v1' }),
    __metadata("design:type", String)
], GeneratedArtifact.prototype, "schemaVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], GeneratedArtifact.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], GeneratedArtifact.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], GeneratedArtifact.prototype, "updatedAt", void 0);
exports.GeneratedArtifact = GeneratedArtifact = __decorate([
    (0, typeorm_1.Entity)('generated_artifacts')
], GeneratedArtifact);
//# sourceMappingURL=generated-artifact.entity.js.map