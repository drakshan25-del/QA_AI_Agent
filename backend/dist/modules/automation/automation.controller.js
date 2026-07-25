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
exports.AutomationController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const automation_service_1 = require("./automation.service");
const automation_dto_1 = require("./dto/automation.dto");
const approval_dto_1 = require("../approvals/dto/approval.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
let AutomationController = class AutomationController {
    constructor(automation) {
        this.automation = automation;
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        return this.automation.generate(projectId, dto, user, correlationId, idempotencyKey);
    }
    async list(projectId, user) {
        return this.automation.listByProject(projectId, user);
    }
    async get(id, user) {
        return this.automation.getOne(id, user);
    }
    async update(id, dto, user, correlationId) {
        return this.automation.updateContent(id, dto.content, user, correlationId);
    }
    async validate(id, user, correlationId) {
        return this.automation.validate(id, user, correlationId);
    }
    async overrideValidation(id, body, user, correlationId) {
        return this.automation.overrideValidation(id, body?.reason || '', user, correlationId);
    }
    async approval(id, dto, user, correlationId) {
        return this.automation.approve(id, dto.decision, dto.comment || '', user, correlationId);
    }
    async executionPlan(id, user, correlationId) {
        return this.automation.executionPlan(id, user, correlationId);
    }
};
exports.AutomationController = AutomationController;
__decorate([
    (0, common_1.Post)('projects/:projectId/automation/generate'),
    (0, permissions_1.RequirePermission)('generation.run'),
    (0, common_1.HttpCode)(202),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __param(4, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, automation_dto_1.GenerateAutomationDto, Object, String, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/automation'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('automation/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)('automation/:id'),
    (0, permissions_1.RequirePermission)('artefact.edit'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, automation_dto_1.UpdateAutomationDto, Object, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('automation/:id/validate'),
    (0, permissions_1.RequirePermission)('generation.run'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "validate", null);
__decorate([
    (0, common_1.Post)('automation/:id/validation-override'),
    (0, permissions_1.RequirePermission)('approval.decide'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "overrideValidation", null);
__decorate([
    (0, common_1.Post)('automation/:id/approval'),
    (0, permissions_1.RequirePermission)('approval.decide'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, approval_dto_1.ApprovalDto, Object, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "approval", null);
__decorate([
    (0, common_1.Get)('automation/:id/execution-plan'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], AutomationController.prototype, "executionPlan", null);
exports.AutomationController = AutomationController = __decorate([
    (0, swagger_1.ApiTags)('automation'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [automation_service_1.AutomationService])
], AutomationController);
//# sourceMappingURL=automation.controller.js.map