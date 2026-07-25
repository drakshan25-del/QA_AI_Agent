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
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const reports_service_1 = require("./reports.service");
const approval_dto_1 = require("../approvals/dto/approval.dto");
const permissions_1 = require("../../common/access/permissions");
const decorators_1 = require("../../common/decorators");
let ReportsController = class ReportsController {
    constructor(reports) {
        this.reports = reports;
    }
    async generate(id, user, correlationId) {
        return this.reports.generate(id, user, correlationId);
    }
    async approve(id, dto, user, correlationId) {
        return this.reports.decidePublication(id, dto.decision, dto.comment || '', user, correlationId);
    }
    async export(id, format = 'json', user, res) {
        const out = await this.reports.export(id, format, user);
        res.setHeader('Content-Type', out.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
        res.send(out.body);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Post)(':id/report/generate'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)()),
    __param(2, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "generate", null);
__decorate([
    (0, common_1.Post)(':id/report/approval'),
    (0, permissions_1.RequirePermission)('approval.decide'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, decorators_1.CorrelationId)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, approval_dto_1.ApprovalDto, Object, String]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "approve", null);
__decorate([
    (0, common_1.Get)(':id/report/export'),
    (0, permissions_1.RequirePermission)('report.export'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('format')),
    __param(2, (0, decorators_1.CurrentUser)()),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "export", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)('reports'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('executions'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map