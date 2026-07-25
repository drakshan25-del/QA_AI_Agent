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
exports.AuditEvent = void 0;
const typeorm_1 = require("typeorm");
let AuditEvent = class AuditEvent {
};
exports.AuditEvent = AuditEvent;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AuditEvent.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "actor", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'actor_id', nullable: true }),
    __metadata("design:type", Object)
], AuditEvent.prototype, "actorId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "action", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'resource_type', default: '' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "resourceType", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'resource_id', default: '' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "resourceId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id', nullable: true }),
    __metadata("design:type", Object)
], AuditEvent.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'success' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "result", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'correlation_id', default: '' }),
    __metadata("design:type", String)
], AuditEvent.prototype, "correlationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', nullable: true }),
    __metadata("design:type", Object)
], AuditEvent.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], AuditEvent.prototype, "createdAt", void 0);
exports.AuditEvent = AuditEvent = __decorate([
    (0, typeorm_1.Entity)('audit_events')
], AuditEvent);
//# sourceMappingURL=audit-event.entity.js.map