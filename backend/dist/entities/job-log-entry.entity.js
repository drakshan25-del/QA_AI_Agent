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
exports.JobLogEntry = void 0;
const typeorm_1 = require("typeorm");
let JobLogEntry = class JobLogEntry {
};
exports.JobLogEntry = JobLogEntry;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], JobLogEntry.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'job_id' }),
    __metadata("design:type", String)
], JobLogEntry.prototype, "jobId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], JobLogEntry.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], JobLogEntry.prototype, "seq", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], JobLogEntry.prototype, "stage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], JobLogEntry.prototype, "message", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'info' }),
    __metadata("design:type", String)
], JobLogEntry.prototype, "severity", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], JobLogEntry.prototype, "progress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], JobLogEntry.prototype, "meta", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], JobLogEntry.prototype, "createdAt", void 0);
exports.JobLogEntry = JobLogEntry = __decorate([
    (0, typeorm_1.Entity)('job_log_entries')
], JobLogEntry);
//# sourceMappingURL=job-log-entry.entity.js.map