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
exports.Finding = void 0;
const typeorm_1 = require("typeorm");
let Finding = class Finding {
};
exports.Finding = Finding;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Finding.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], Finding.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'execution_run_id', nullable: true }),
    __metadata("design:type", Object)
], Finding.prototype, "executionRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'test_result_id', nullable: true }),
    __metadata("design:type", Object)
], Finding.prototype, "testResultId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'inconclusive' }),
    __metadata("design:type", String)
], Finding.prototype, "classification", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', default: 0.5 }),
    __metadata("design:type", Number)
], Finding.prototype, "confidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Finding.prototype, "rationale", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'medium' }),
    __metadata("design:type", String)
], Finding.prototype, "severity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Finding.prototype, "overridden", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', name: 'override_reason', default: '' }),
    __metadata("design:type", String)
], Finding.prototype, "overrideReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'defect_draft', nullable: true }),
    __metadata("design:type", Object)
], Finding.prototype, "defectDraft", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], Finding.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Finding.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], Finding.prototype, "updatedAt", void 0);
exports.Finding = Finding = __decorate([
    (0, typeorm_1.Entity)('findings')
], Finding);
//# sourceMappingURL=finding.entity.js.map