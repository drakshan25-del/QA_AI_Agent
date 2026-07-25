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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestPlansController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const test_plans_service_1 = require("./test-plans.service");
const test_plan_dto_1 = require("./dto/test-plan.dto");
const approval_dto_1 = require("../approvals/dto/approval.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
let TestPlansController = class TestPlansController {
    constructor(plans) {
        this.plans = plans;
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        return this.plans.generate(projectId, dto, user, correlationId, idempotencyKey);
    }
    async list(projectId, user) {
        return this.plans.listByProject(projectId, user);
    }
    async get(id, user) {
        return this.plans.getOne(id, user);
    }
    async update(id, dto, user, correlationId) {
        return this.plans.update(id, dto, user, correlationId);
    }
    async approval(id, dto, user, correlationId) {
        return this.plans.approve(id, dto.decision, dto.comment || '', user, correlationId);
    }
    async revisions(id, user) {
        return this.plans.listRevisions(id, user);
    }
    async compare(id, from, to, user) {
        return this.plans.compareRevisions(id, parseInt(from, 10), parseInt(to, 10), user);
    }
    async revision(id, version, user) {
        return this.plans.getRevision(id, parseInt(version, 10), user);
    }
    async restore(id, version, user, correlationId) {
        return this.plans.restoreRevision(id, parseInt(version, 10), user, correlationId);
    }
    async export(id, format = 'md', user, res) {
        const out = await this.plans.export(id, format, user);
        res.setHeader('Content-Type', out.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
        res.send(out.body);
    }
};
exports.TestPlansController = TestPlansController;
__decorate([
    (0, common_1.Post)('projects/:projectId/test-plans/generate'),
    (0, permissions_1.RequirePermission)('generation.run'),
    (0, common_1.HttpCode)(202),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __param(4, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, test_plan_dto_1.GenerateTestPlanDto, Object, String, String]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/test-plans'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('test-plans/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)('test-plans/:id'),
    (0, permissions_1.RequirePermission)('artefact.edit'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, test_plan_dto_1.UpdateTestPlanDto, Object, String]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('test-plans/:id/approval'),
    (0, permissions_1.RequirePermission)('approval.decide'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, approval_dto_1.ApprovalDto, Object, String]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "approval", null);
__decorate([
    (0, common_1.Get)('test-plans/:id/revisions'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "revisions", null);
__decorate([
    (0, common_1.Get)('test-plans/:id/revisions/compare'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "compare", null);
__decorate([
    (0, common_1.Get)('test-plans/:id/revisions/:version'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('version')),
    __param(2, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "revision", null);
__decorate([
    (0, common_1.Post)('test-plans/:id/revisions/:version/restore'),
    (0, permissions_1.RequirePermission)('artefact.edit'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('version')),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, String]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "restore", null);
__decorate([
    (0, common_1.Get)('test-plans/:id/export'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('format')),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TestPlansController.prototype, "export", null);
exports.TestPlansController = TestPlansController = __decorate([
    (0, swagger_1.ApiTags)('test-plans'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [test_plans_service_1.TestPlansService])
], TestPlansController);
//# sourceMappingURL=test-plans.controller.js.map