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
exports.FindingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const findings_service_1 = require("./findings.service");
const finding_dto_1 = require("./dto/finding.dto");
const decorators_1 = require("../../common/decorators");
const permissions_1 = require("../../common/access/permissions");
let FindingsController = class FindingsController {
    constructor(findings) {
        this.findings = findings;
    }
    async classify(id, dto, user, correlationId) {
        return this.findings.classify(id, dto.context, user, correlationId);
    }
    async override(id, dto, user, correlationId) {
        return this.findings.override(id, dto.classification, dto.reason, user, correlationId);
    }
    async defectDraft(id, user, correlationId) {
        return this.findings.defectDraft(id, user, correlationId);
    }
};
exports.FindingsController = FindingsController;
__decorate([
    (0, common_1.Post)('results/:id/classify'),
    (0, permissions_1.RequirePermission)('generation.run'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, finding_dto_1.ClassifyDto, Object, String]),
    __metadata("design:returntype", Promise)
], FindingsController.prototype, "classify", null);
__decorate([
    (0, common_1.Post)('findings/:id/override'),
    (0, permissions_1.RequirePermission)('classification.override'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, finding_dto_1.OverrideFindingDto, Object, String]),
    __metadata("design:returntype", Promise)
], FindingsController.prototype, "override", null);
__decorate([
    (0, common_1.Post)('findings/:id/defect-draft'),
    (0, permissions_1.RequirePermission)('generation.run'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], FindingsController.prototype, "defectDraft", null);
exports.FindingsController = FindingsController = __decorate([
    (0, swagger_1.ApiTags)('findings'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [findings_service_1.FindingsService])
], FindingsController);
//# sourceMappingURL=findings.controller.js.map