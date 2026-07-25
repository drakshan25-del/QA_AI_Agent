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
exports.ExecutionLogEntry = void 0;
const typeorm_1 = require("typeorm");
let ExecutionLogEntry = class ExecutionLogEntry {
};
exports.ExecutionLogEntry = ExecutionLogEntry;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'execution_run_id' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "executionRunId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], ExecutionLogEntry.prototype, "seq", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "stage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'info' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "level", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "message", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], ExecutionLogEntry.prototype, "progress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'test_case_id', default: '' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "testCaseId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'test_name', default: '' }),
    __metadata("design:type", String)
], ExecutionLogEntry.prototype, "testName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], ExecutionLogEntry.prototype, "meta", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ExecutionLogEntry.prototype, "createdAt", void 0);
exports.ExecutionLogEntry = ExecutionLogEntry = __decorate([
    (0, typeorm_1.Entity)('execution_log_entries'),
    (0, typeorm_1.Index)(['executionRunId', 'seq'])
], ExecutionLogEntry);
//# sourceMappingURL=execution-log-entry.entity.js.map