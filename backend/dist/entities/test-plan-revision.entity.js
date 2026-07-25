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
exports.TestPlanRevision = void 0;
const typeorm_1 = require("typeorm");
let TestPlanRevision = class TestPlanRevision {
};
exports.TestPlanRevision = TestPlanRevision;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'test_plan_id' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "testPlanId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', name: 'project_id' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "projectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], TestPlanRevision.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json' }),
    __metadata("design:type", Object)
], TestPlanRevision.prototype, "sections", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'content_hash', default: '' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "contentHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'source_action', default: 'edited' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "sourceAction", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'change_summary', default: '' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "changeSummary", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'approval_status', default: 'pending' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "approvalStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: '' }),
    __metadata("design:type", String)
], TestPlanRevision.prototype, "author", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', name: 'author_id', nullable: true }),
    __metadata("design:type", Object)
], TestPlanRevision.prototype, "authorId", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TestPlanRevision.prototype, "createdAt", void 0);
exports.TestPlanRevision = TestPlanRevision = __decorate([
    (0, typeorm_1.Entity)('test_plan_revisions'),
    (0, typeorm_1.Unique)(['testPlanId', 'version'])
], TestPlanRevision);
//# sourceMappingURL=test-plan-revision.entity.js.map