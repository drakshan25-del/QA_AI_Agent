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
exports.TestCase = void 0;
const typeorm_1 = require("typeorm");
let TestCase = class TestCase {
};
exports.TestCase = TestCase;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TestCase.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], TestCase.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'generation_run_id', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "generationRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'requirement_ids', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "requirementIds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'case_key', default: '' }),
    __metadata("design:type", String)
], TestCase.prototype, "caseKey", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], TestCase.prototype, "seq", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'human_id', default: '' }),
    __metadata("design:type", String)
], TestCase.prototype, "humanId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TestCase.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], TestCase.prototype, "objective", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'positive' }),
    __metadata("design:type", String)
], TestCase.prototype, "category", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'medium' }),
    __metadata("design:type", String)
], TestCase.prototype, "priority", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "preconditions", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'test_data', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "testData", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "steps", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'expected_results', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "expectedResults", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'automation_suitability', default: 'automatable' }),
    __metadata("design:type", String)
], TestCase.prototype, "automationSuitability", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'ai' }),
    __metadata("design:type", String)
], TestCase.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'approval_status', default: 'pending' }),
    __metadata("design:type", String)
], TestCase.prototype, "approvalStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', name: 'approval_invalidated', default: false }),
    __metadata("design:type", Boolean)
], TestCase.prototype, "approvalInvalidated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'automation_status', default: 'none' }),
    __metadata("design:type", String)
], TestCase.prototype, "automationStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 1 }),
    __metadata("design:type", Number)
], TestCase.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'schema_version', default: 'v1' }),
    __metadata("design:type", String)
], TestCase.prototype, "schemaVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], TestCase.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], TestCase.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TestCase.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], TestCase.prototype, "updatedAt", void 0);
exports.TestCase = TestCase = __decorate([
    (0, typeorm_1.Entity)('test_cases')
], TestCase);
//# sourceMappingURL=test-case.entity.js.map