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
exports.ProjectExecutionsController = exports.ExecutionsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const executions_service_1 = require("./executions.service");
const execution_dto_1 = require("./dto/execution.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
const errors_1 = require("../../common/errors");
let ExecutionsController = class ExecutionsController {
    constructor(executions) {
        this.executions = executions;
    }
    async create(dto, user, correlationId, idempotencyKey) {
        return this.executions.create(dto, user, correlationId, idempotencyKey);
    }
    async get(id, user) {
        return this.executions.getOne(id, user);
    }
    async events(id, user, fromSeq) {
        return this.executions.getEvents(id, user, fromSeq ? parseInt(fromSeq, 10) : 0);
    }
    async results(id, user) {
        return this.executions.getResults(id, user);
    }
    async logs(id, user, fromSeq) {
        return this.executions.getLogs(id, user, fromSeq ? parseInt(fromSeq, 10) : 0);
    }
    async cancel(id, user, correlationId) {
        return this.executions.cancel(id, user, correlationId);
    }
    async restart(id, user, correlationId) {
        return this.executions.restart(id, user, correlationId);
    }
    async report(id, user) {
        const report = await this.executions.getStoredReport(id, user);
        if (!report) {
            throw new errors_1.NotFoundAppException(`No report generated for execution ${id}. POST /executions/${id}/report/generate first.`);
        }
        return report;
    }
};
exports.ExecutionsController = ExecutionsController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(202),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    (0, permissions_1.RequirePermission)('execution.run'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __param(3, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [execution_dto_1.CreateExecutionDto, Object, String, String]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/events'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('fromSeq')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "events", null);
__decorate([
    (0, common_1.Get)(':id/results'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "results", null);
__decorate([
    (0, common_1.Get)(':id/logs'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('fromSeq')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "logs", null);
__decorate([
    (0, common_1.Post)(':id/cancel'),
    (0, permissions_1.RequirePermission)('execution.control'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)(':id/restart'),
    (0, common_1.HttpCode)(202),
    (0, permissions_1.RequirePermission)('execution.run'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "restart", null);
__decorate([
    (0, common_1.Get)(':id/report'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ExecutionsController.prototype, "report", null);
exports.ExecutionsController = ExecutionsController = __decorate([
    (0, swagger_1.ApiTags)('executions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('executions'),
    __metadata("design:paramtypes", [executions_service_1.ExecutionsService])
], ExecutionsController);
let ProjectExecutionsController = class ProjectExecutionsController {
    constructor(executions) {
        this.executions = executions;
    }
    async list(projectId, user) {
        return this.executions.listByProject(projectId, user);
    }
};
exports.ProjectExecutionsController = ProjectExecutionsController;
__decorate([
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    (0, common_1.Get)('projects/:projectId/executions'),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ProjectExecutionsController.prototype, "list", null);
exports.ProjectExecutionsController = ProjectExecutionsController = __decorate([
    (0, swagger_1.ApiTags)('executions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [executions_service_1.ExecutionsService])
], ProjectExecutionsController);
//# sourceMappingURL=executions.controller.js.map