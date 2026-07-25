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
exports.AuditController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const audit_service_1 = require("./audit.service");
const membership_service_1 = require("../../common/access/membership.service");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
let AuditController = class AuditController {
    constructor(audit, membership) {
        this.audit = audit;
        this.membership = membership;
    }
    async list(user, actor, action, resourceType, resourceId, projectId, from, to, limit, offset) {
        if (user.role !== 'admin') {
            if (!projectId) {
                throw new errors_1.ForbiddenAppException('Non-admin audit queries must be scoped with ?projectId=<project you belong to>');
            }
            await this.membership.ensureMember(projectId, user);
        }
        return this.audit.query({
            actor,
            action,
            resourceType,
            resourceId,
            projectId,
            from,
            to,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
    }
};
exports.AuditController = AuditController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('actor')),
    __param(2, (0, common_1.Query)('action')),
    __param(3, (0, common_1.Query)('resourceType')),
    __param(4, (0, common_1.Query)('resourceId')),
    __param(5, (0, common_1.Query)('projectId')),
    __param(6, (0, common_1.Query)('from')),
    __param(7, (0, common_1.Query)('to')),
    __param(8, (0, common_1.Query)('limit')),
    __param(9, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AuditController.prototype, "list", null);
exports.AuditController = AuditController = __decorate([
    (0, swagger_1.ApiTags)('audit'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('audit'),
    __metadata("design:paramtypes", [audit_service_1.AuditService,
        membership_service_1.MembershipService])
], AuditController);
//# sourceMappingURL=audit.controller.js.map