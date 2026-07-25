"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const membership_service_1 = require("./membership.service");
const project_member_guard_1 = require("./project-member.guard");
const permissions_1 = require("./permissions");
let AccessModule = class AccessModule {
};
exports.AccessModule = AccessModule;
exports.AccessModule = AccessModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([entities_1.Project, entities_1.ProjectMember, entities_1.User])],
        providers: [
            membership_service_1.MembershipService,
            project_member_guard_1.ProjectMemberGuard,
            permissions_1.PermissionsGuard,
            { provide: core_1.APP_GUARD, useClass: permissions_1.PermissionsGuard },
        ],
        exports: [membership_service_1.MembershipService, project_member_guard_1.ProjectMemberGuard, permissions_1.PermissionsGuard, typeorm_1.TypeOrmModule],
    })
], AccessModule);
//# sourceMappingURL=access.module.js.map