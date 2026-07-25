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
exports.AnalysisController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const analysis_service_1 = require("./analysis.service");
const analysis_dto_1 = require("./dto/analysis.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
let AnalysisController = class AnalysisController {
    constructor(analysis) {
        this.analysis = analysis;
    }
    async create(projectId, dto, user, correlationId, idempotencyKey) {
        return this.analysis.createJob(projectId, dto, user, correlationId, idempotencyKey);
    }
    async list(projectId, user) {
        return this.analysis.listByProject(projectId, user);
    }
    async get(id, user) {
        return this.analysis.getOne(id, user);
    }
};
exports.AnalysisController = AnalysisController;
__decorate([
    (0, common_1.Post)('projects/:projectId/analysis-jobs'),
    (0, permissions_1.RequirePermission)('generation.run'),
    (0, common_1.HttpCode)(202),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __param(4, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, analysis_dto_1.CreateAnalysisJobDto, Object, String, String]),
    __metadata("design:returntype", Promise)
], AnalysisController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/analyses'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AnalysisController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('analyses/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AnalysisController.prototype, "get", null);
exports.AnalysisController = AnalysisController = __decorate([
    (0, swagger_1.ApiTags)('analysis'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [analysis_service_1.AnalysisService])
], AnalysisController);
//# sourceMappingURL=analysis.controller.js.map