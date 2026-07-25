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
exports.JobsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jobs_service_1 = require("./jobs.service");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
const decorators_1 = require("../../common/decorators");
let JobsController = class JobsController {
    constructor(jobs) {
        this.jobs = jobs;
    }
    async get(id, user) {
        return this.jobs.get(id, user);
    }
    async logs(id, user, fromSeq) {
        return this.jobs.getLogs(id, fromSeq ? parseInt(fromSeq, 10) : 0, user);
    }
    async cancel(id, user) {
        return this.jobs.cancel(id, user);
    }
    async retry(id, user, correlationId) {
        return this.jobs.retry(id, user, correlationId);
    }
    async list(projectId) {
        return this.jobs.listByProject(projectId);
    }
};
exports.JobsController = JobsController;
__decorate([
    (0, common_1.Get)('jobs/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('jobs/:id/logs'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('fromSeq')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "logs", null);
__decorate([
    (0, common_1.Post)('jobs/:id/cancel'),
    (0, permissions_1.RequirePermission)('generation.run'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)('jobs/:id/retry'),
    (0, permissions_1.RequirePermission)('generation.run'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "retry", null);
__decorate([
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    (0, common_1.Get)('projects/:projectId/jobs'),
    __param(0, (0, common_1.Param)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "list", null);
exports.JobsController = JobsController = __decorate([
    (0, swagger_1.ApiTags)('jobs'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [jobs_service_1.JobsService])
], JobsController);
//# sourceMappingURL=jobs.controller.js.map