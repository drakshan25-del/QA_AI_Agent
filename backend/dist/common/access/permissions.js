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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsGuard = exports.RequirePermission = exports.PERMISSION_KEY = exports.PERMISSION_ROLES = void 0;
exports.hasPermission = hasPermission;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const errors_1 = require("../errors");
const ALL_EDIT_ROLES = [
    'admin',
    'qa_lead',
    'qa_engineer',
    'automation_engineer',
    'supervisor',
    'devops',
];
exports.PERMISSION_ROLES = {
    'project.write': ALL_EDIT_ROLES,
    'document.upload': [...ALL_EDIT_ROLES, 'developer'],
    'generation.run': ALL_EDIT_ROLES,
    'artefact.edit': ALL_EDIT_ROLES,
    'approval.decide': ['admin', 'qa_lead', 'reviewer', 'supervisor'],
    'execution.run': ALL_EDIT_ROLES,
    'execution.control': ALL_EDIT_ROLES,
    'git.push': ['admin', 'qa_lead', 'automation_engineer', 'devops'],
    'ci.trigger': ['admin', 'qa_lead', 'automation_engineer', 'devops'],
    'classification.override': [
        'admin',
        'qa_lead',
        'qa_engineer',
        'reviewer',
        'developer',
        'supervisor',
    ],
    'report.export': [
        'admin',
        'qa_lead',
        'qa_engineer',
        'automation_engineer',
        'developer',
        'reviewer',
        'supervisor',
        'devops',
    ],
    'admin.manage': ['admin'],
};
function hasPermission(role, permission) {
    if (role === 'admin')
        return true;
    return (exports.PERMISSION_ROLES[permission] ?? []).includes(role);
}
exports.PERMISSION_KEY = 'requiredPermission';
const RequirePermission = (permission) => (0, common_1.SetMetadata)(exports.PERMISSION_KEY, permission);
exports.RequirePermission = RequirePermission;
let PermissionsGuard = class PermissionsGuard {
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const permission = this.reflector.getAllAndOverride(exports.PERMISSION_KEY, [context.getHandler(), context.getClass()]);
        if (!permission)
            return true;
        const user = context.switchToHttp().getRequest().user;
        if (!user)
            throw new errors_1.ForbiddenAppException('No authenticated user');
        if (hasPermission(user.role, permission))
            return true;
        throw new errors_1.ForbiddenAppException(`Your role (${user.role}) does not include the "${permission}" permission.`, { permission, role: user.role });
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], PermissionsGuard);
//# sourceMappingURL=permissions.js.map