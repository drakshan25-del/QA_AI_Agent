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
exports.Job = void 0;
const typeorm_1 = require("typeorm");
const column_types_1 = require("../common/column-types");
let Job = class Job {
};
exports.Job = Job;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Job.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], Job.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], Job.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'queued' }),
    __metadata("design:type", String)
], Job.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Job.prototype, "progress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'correlation_id', default: '' }),
    __metadata("design:type", String)
], Job.prototype, "correlationId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'idempotency_key', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "idempotencyKey", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'input_refs', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "inputRefs", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', name: 'result_refs', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "resultRefs", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Job.prototype, "error", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', name: 'cancel_requested', default: false }),
    __metadata("design:type", Boolean)
], Job.prototype, "cancelRequested", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'retry_of_job_id', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "retryOfJobId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'current_stage', default: '' }),
    __metadata("design:type", String)
], Job.prototype, "currentStage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: column_types_1.DATETIME_TYPE, name: 'started_at', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: column_types_1.DATETIME_TYPE, name: 'finished_at', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "finishedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'created_by', nullable: true }),
    __metadata("design:type", Object)
], Job.prototype, "createdBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Job.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], Job.prototype, "updatedAt", void 0);
exports.Job = Job = __decorate([
    (0, typeorm_1.Entity)('jobs')
], Job);
//# sourceMappingURL=job.entity.js.map