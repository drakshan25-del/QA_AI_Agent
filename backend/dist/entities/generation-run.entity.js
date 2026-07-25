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
exports.GenerationRun = void 0;
const typeorm_1 = require("typeorm");
let GenerationRun = class GenerationRun {
};
exports.GenerationRun = GenerationRun;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], GenerationRun.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'job_id', nullable: true }),
    __metadata("design:type", Object)
], GenerationRun.prototype, "jobId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'input_refs', nullable: true }),
    __metadata("design:type", Object)
], GenerationRun.prototype, "inputRefs", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', default: 0.1 }),
    __metadata("design:type", Number)
], GenerationRun.prototype, "temperature", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'schema_version', default: 'v1' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "schemaVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'completed' }),
    __metadata("design:type", String)
], GenerationRun.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], GenerationRun.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], GenerationRun.prototype, "createdAt", void 0);
exports.GenerationRun = GenerationRun = __decorate([
    (0, typeorm_1.Entity)('generation_runs')
], GenerationRun);
//# sourceMappingURL=generation-run.entity.js.map