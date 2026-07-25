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
exports.RequirementsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const requirements_service_1 = require("./requirements.service");
const requirement_dto_1 = require("./dto/requirement.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
let RequirementsController = class RequirementsController {
    constructor(requirements) {
        this.requirements = requirements;
    }
    async create(projectId, dto, user, correlationId) {
        return this.requirements.create(projectId, dto, user, correlationId);
    }
    async list(projectId, user) {
        return this.requirements.listByProject(projectId, user);
    }
    async get(id, user) {
        return this.requirements.getOne(id, user);
    }
    async history(id, user) {
        return this.requirements.history(id, user);
    }
    async versions(id, user) {
        return this.requirements.versions(id, user);
    }
};
exports.RequirementsController = RequirementsController;
__decorate([
    (0, common_1.Post)('projects/:projectId/requirements'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, requirement_dto_1.CreateRequirementDto, Object, String]),
    __metadata("design:returntype", Promise)
], RequirementsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/requirements'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RequirementsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('requirements/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RequirementsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('requirements/:id/history'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RequirementsController.prototype, "history", null);
__decorate([
    (0, common_1.Get)('requirements/:id/versions'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RequirementsController.prototype, "versions", null);
exports.RequirementsController = RequirementsController = __decorate([
    (0, swagger_1.ApiTags)('requirements'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [requirements_service_1.RequirementsService])
], RequirementsController);
//# sourceMappingURL=requirements.controller.js.map