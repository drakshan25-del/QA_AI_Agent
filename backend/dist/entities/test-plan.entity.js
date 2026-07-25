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
exports.TestPlan = void 0;
const typeorm_1 = require("typeorm");
let TestPlan = class TestPlan {
};
exports.TestPlan = TestPlan;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TestPlan.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], TestPlan.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'generation_run_id', nullable: true }),
    __metadata("design:type", Object)
], TestPlan.prototype, "generationRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], TestPlan.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], TestPlan.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'approval_status', default: 'pending' }),
    __metadata("design:type", String)
], TestPlan.prototype, "approvalStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', name: 'approval_invalidated', default: false }),
    __metadata("design:type", Boolean)
], TestPlan.prototype, "approvalInvalidated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'schema_version', default: 'v1' }),
    __metadata("design:type", String)
], TestPlan.prototype, "schemaVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], TestPlan.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json' }),
    __metadata("design:type", Object)
], TestPlan.prototype, "sections", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], TestPlan.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], TestPlan.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TestPlan.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], TestPlan.prototype, "updatedAt", void 0);
exports.TestPlan = TestPlan = __decorate([
    (0, typeorm_1.Entity)('test_plans')
], TestPlan);
//# sourceMappingURL=test-plan.entity.js.map