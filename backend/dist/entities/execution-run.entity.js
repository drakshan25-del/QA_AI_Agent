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
exports.ExecutionRun = void 0;
const typeorm_1 = require("typeorm");
const column_types_1 = require("../common/column-types");
let ExecutionRun = class ExecutionRun {
};
exports.ExecutionRun = ExecutionRun;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ExecutionRun.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'local' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "mode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'queued' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'local' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "environment", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'chromium' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "browser", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], ExecutionRun.prototype, "headed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'automation_ids', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "automationIds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'test_paths', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "testPaths", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'run_scope', default: 'selected' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "runScope", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "settings", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'restart_of_run_id', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "restartOfRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "metrics", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "evidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'ci_run_id', default: '' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "ciRunId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'ci_url', default: '' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "ciUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'correlation_id', default: '' }),
    __metadata("design:type", String)
], ExecutionRun.prototype, "correlationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "report", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: column_types_1.DATETIME_TYPE, name: 'started_at', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: column_types_1.DATETIME_TYPE, name: 'finished_at', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "finishedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], ExecutionRun.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ExecutionRun.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], ExecutionRun.prototype, "updatedAt", void 0);
exports.ExecutionRun = ExecutionRun = __decorate([
    (0, typeorm_1.Entity)('execution_runs')
], ExecutionRun);
//# sourceMappingURL=execution-run.entity.js.map