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
exports.EventSubscription = void 0;
const typeorm_1 = require("typeorm");
let EventSubscription = class EventSubscription {
};
exports.EventSubscription = EventSubscription;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], EventSubscription.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], EventSubscription.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'run_id', nullable: true }),
    __metadata("design:type", Object)
], EventSubscription.prototype, "runId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'client_id', default: '' }),
    __metadata("design:type", String)
], EventSubscription.prototype, "clientId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'user_id', nullable: true }),
    __metadata("design:type", Object)
], EventSubscription.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'last_seq', default: 0 }),
    __metadata("design:type", Number)
], EventSubscription.prototype, "lastSeq", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], EventSubscription.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], EventSubscription.prototype, "updatedAt", void 0);
exports.EventSubscription = EventSubscription = __decorate([
    (0, typeorm_1.Entity)('event_subscriptions')
], EventSubscription);
//# sourceMappingURL=event-subscription.entity.js.map