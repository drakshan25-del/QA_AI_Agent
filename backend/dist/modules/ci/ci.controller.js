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
exports.CiController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const ci_service_1 = require("./ci.service");
const ci_dto_1 = require("./dto/ci.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const permissions_1 = require("../../common/access/permissions");
let CiController = class CiController {
    constructor(ci) {
        this.ci = ci;
    }
    async dispatch(dto, user, correlationId) {
        return this.ci.dispatch(dto, user, correlationId);
    }
    async getRun(id, user) {
        return this.ci.getRun(id, user);
    }
    async listRuns(projectId, user) {
        return this.ci.listRuns(projectId, user);
    }
    async importRun(id, body, user, correlationId) {
        return this.ci.importRun(id, body, user, correlationId);
    }
};
exports.CiController = CiController;
__decorate([
    (0, common_1.Post)('workflows/dispatch'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard, roles_guard_1.RolesGuard),
    (0, decorators_1.Roles)('devops', 'automation_engineer', 'supervisor', 'admin'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ci_dto_1.DispatchWorkflowDto, Object, String]),
    __metadata("design:returntype", Promise)
], CiController.prototype, "dispatch", null);
__decorate([
    (0, common_1.Get)('runs/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CiController.prototype, "getRun", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/runs'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CiController.prototype, "listRuns", null);
__decorate([
    (0, common_1.Post)('runs/:id/import'),
    (0, permissions_1.RequirePermission)('ci.trigger'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, String]),
    __metadata("design:returntype", Promise)
], CiController.prototype, "importRun", null);
exports.CiController = CiController = __decorate([
    (0, swagger_1.ApiTags)('ci'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('ci'),
    __metadata("design:paramtypes", [ci_service_1.CiService])
], CiController);
//# sourceMappingURL=ci.controller.js.map