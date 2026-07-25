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
exports.GitController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const git_service_1 = require("./git.service");
const git_dto_1 = require("./dto/git.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const permissions_1 = require("../../common/access/permissions");
let GitController = class GitController {
    constructor(git) {
        this.git = git;
    }
    async commit(projectId, dto, user, correlationId) {
        return this.git.commit(projectId, dto, user, correlationId);
    }
};
exports.GitController = GitController;
__decorate([
    (0, common_1.Post)('projects/:projectId/git/commit'),
    (0, permissions_1.RequirePermission)('git.push'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard, roles_guard_1.RolesGuard),
    (0, decorators_1.Roles)('automation_engineer', 'devops', 'supervisor', 'admin'),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, git_dto_1.GitCommitDto, Object, String]),
    __metadata("design:returntype", Promise)
], GitController.prototype, "commit", null);
exports.GitController = GitController = __decorate([
    (0, swagger_1.ApiTags)('git'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [git_service_1.GitService])
], GitController);
//# sourceMappingURL=git.controller.js.map