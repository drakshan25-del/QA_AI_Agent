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
exports.TestCasesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const test_cases_service_1 = require("./test-cases.service");
const test_case_dto_1 = require("./dto/test-case.dto");
const approval_dto_1 = require("../approvals/dto/approval.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const permissions_1 = require("../../common/access/permissions");
let TestCasesController = class TestCasesController {
    constructor(cases) {
        this.cases = cases;
    }
    async generate(projectId, dto, user, correlationId, idempotencyKey) {
        return this.cases.generate(projectId, dto, user, correlationId, idempotencyKey);
    }
    async list(projectId, user, source, priority, type, approval, automation, q, page, pageSize) {
        return this.cases.list(projectId, {
            source,
            priority,
            type,
            approval,
            automation,
            q,
            page: page ? parseInt(page, 10) : undefined,
            pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
        }, user);
    }
    async coverage(projectId, user) {
        return this.cases.coverage(projectId, user);
    }
    async get(id, user) {
        return this.cases.getOne(id, user);
    }
    async update(id, dto, user, correlationId) {
        return this.cases.update(id, dto, user, correlationId);
    }
    async approve(dto, user, correlationId) {
        return this.cases.approve(dto.ids, dto.decision, dto.comment || '', user, correlationId);
    }
};
exports.TestCasesController = TestCasesController;
__decorate([
    (0, common_1.Post)('projects/:projectId/test-cases/generate'),
    (0, permissions_1.RequirePermission)('generation.run'),
    (0, common_1.HttpCode)(202),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __param(4, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, test_case_dto_1.GenerateTestCasesDto, Object, String, String]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/test-cases'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, common_1.Query)('source')),
    __param(3, (0, common_1.Query)('priority')),
    __param(4, (0, common_1.Query)('type')),
    __param(5, (0, common_1.Query)('approval')),
    __param(6, (0, common_1.Query)('automation')),
    __param(7, (0, common_1.Query)('q')),
    __param(8, (0, common_1.Query)('page')),
    __param(9, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/coverage'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "coverage", null);
__decorate([
    (0, common_1.Get)('test-cases/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)('test-cases/:id'),
    (0, permissions_1.RequirePermission)('artefact.edit'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, test_case_dto_1.UpdateTestCaseDto, Object, String]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('test-cases/approval'),
    (0, permissions_1.RequirePermission)('approval.decide'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [approval_dto_1.BulkApprovalDto, Object, String]),
    __metadata("design:returntype", Promise)
], TestCasesController.prototype, "approve", null);
exports.TestCasesController = TestCasesController = __decorate([
    (0, swagger_1.ApiTags)('test-cases'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [test_cases_service_1.TestCasesService])
], TestCasesController);
//# sourceMappingURL=test-cases.controller.js.map