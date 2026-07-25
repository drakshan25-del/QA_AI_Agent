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
exports.TestResult = void 0;
const typeorm_1 = require("typeorm");
let TestResult = class TestResult {
};
exports.TestResult = TestResult;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TestResult.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'execution_run_id' }),
    __metadata("design:type", String)
], TestResult.prototype, "executionRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'test_case_id', nullable: true }),
    __metadata("design:type", Object)
], TestResult.prototype, "testCaseId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'node_id', default: '' }),
    __metadata("design:type", String)
], TestResult.prototype, "nodeId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'passed' }),
    __metadata("design:type", String)
], TestResult.prototype, "outcome", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'float', name: 'duration_seconds', default: 0 }),
    __metadata("design:type", Number)
], TestResult.prototype, "durationSeconds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', name: 'error_message', default: '' }),
    __metadata("design:type", String)
], TestResult.prototype, "errorMessage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], TestResult.prototype, "evidence", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TestResult.prototype, "createdAt", void 0);
exports.TestResult = TestResult = __decorate([
    (0, typeorm_1.Entity)('test_results')
], TestResult);
//# sourceMappingURL=test-result.entity.js.map