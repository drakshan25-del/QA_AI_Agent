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
exports.Approval = void 0;
const typeorm_1 = require("typeorm");
let Approval = class Approval {
};
exports.Approval = Approval;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Approval.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], Approval.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'resource_type' }),
    __metadata("design:type", String)
], Approval.prototype, "resourceType", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'resource_id' }),
    __metadata("design:type", String)
], Approval.prototype, "resourceId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'resource_version', default: 1 }),
    __metadata("design:type", Number)
], Approval.prototype, "resourceVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], Approval.prototype, "decision", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Approval.prototype, "comment", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Approval.prototype, "invalidated", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'actor_id', nullable: true }),
    __metadata("design:type", Object)
], Approval.prototype, "actorId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], Approval.prototype, "actor", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Approval.prototype, "createdAt", void 0);
exports.Approval = Approval = __decorate([
    (0, typeorm_1.Entity)('approvals')
], Approval);
//# sourceMappingURL=approval.entity.js.map