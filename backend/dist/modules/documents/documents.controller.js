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
exports.DocumentsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const documents_service_1 = require("./documents.service");
const document_dto_1 = require("./dto/document.dto");
const decorators_1 = require("../../common/decorators");
const project_member_guard_1 = require("../../common/access/project-member.guard");
const enums_1 = require("../../common/enums");
const errors_1 = require("../../common/errors");
const permissions_1 = require("../../common/access/permissions");
const MAX_FILES = 20;
let DocumentsController = class DocumentsController {
    constructor(documents) {
        this.documents = documents;
    }
    async upload(projectId, files, body, user, correlationId) {
        if (!files || files.length === 0) {
            throw new errors_1.ValidationFailedException('No files uploaded (field: files)');
        }
        const categories = resolveCategories(body, files.length);
        const results = await this.documents.upload(projectId, files, categories, user, correlationId);
        return { documents: results };
    }
    async list(projectId, user) {
        return this.documents.listByProject(projectId, user);
    }
    async get(id, user) {
        return this.documents.getOne(id, user);
    }
    async preview(id, user) {
        return this.documents.preview(id, user);
    }
    async updateSegments(id, dto, user, correlationId) {
        return this.documents.updateSegments(id, dto.segments, user, correlationId);
    }
    async remove(id, user, correlationId) {
        await this.documents.remove(id, user, correlationId);
    }
};
exports.DocumentsController = DocumentsController;
__decorate([
    (0, common_1.Post)('projects/:projectId/documents'),
    (0, permissions_1.RequirePermission)('document.upload'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, common_1.UseInterceptors)((0, platform_express_1.AnyFilesInterceptor)({
        limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
    })),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, decorators_1.CurrentUser)()),
    __param(4, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array, Object, Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('projects/:projectId/documents'),
    (0, common_1.UseGuards)(project_member_guard_1.ProjectMemberGuard),
    __param(0, (0, common_1.Param)('projectId')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('documents/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('documents/:id/preview'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "preview", null);
__decorate([
    (0, common_1.Patch)('documents/:id/segments'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, document_dto_1.UpdateSegmentsDto, Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "updateSegments", null);
__decorate([
    (0, common_1.Delete)('documents/:id'),
    (0, permissions_1.RequirePermission)('document.upload'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "remove", null);
exports.DocumentsController = DocumentsController = __decorate([
    (0, swagger_1.ApiTags)('documents'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [documents_service_1.DocumentsService])
], DocumentsController);
function coerceCategory(value) {
    const v = String(value || '').trim();
    return enums_1.DOCUMENT_CATEGORIES.includes(v)
        ? v
        : 'user_story';
}
function resolveCategories(body, count) {
    const single = body.category ? coerceCategory(body.category) : undefined;
    let list;
    const raw = body.categories;
    if (Array.isArray(raw)) {
        list = raw.map(coerceCategory);
    }
    else if (typeof raw === 'string' && raw.trim()) {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[')) {
            try {
                const arr = JSON.parse(trimmed);
                list = arr.map(coerceCategory);
            }
            catch {
                list = trimmed.split(',').map(coerceCategory);
            }
        }
        else {
            list = trimmed.split(',').map(coerceCategory);
        }
    }
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(list?.[i] ?? single ?? 'user_story');
    }
    return out;
}
//# sourceMappingURL=documents.controller.js.map