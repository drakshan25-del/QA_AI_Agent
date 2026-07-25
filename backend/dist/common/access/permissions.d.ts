import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums';
export type Permission = 'project.write' | 'document.upload' | 'generation.run' | 'artefact.edit' | 'approval.decide' | 'execution.run' | 'execution.control' | 'git.push' | 'ci.trigger' | 'classification.override' | 'report.export' | 'admin.manage';
export declare const PERMISSION_ROLES: Record<Permission, Role[]>;
export declare function hasPermission(role: Role, permission: Permission): boolean;
export declare const PERMISSION_KEY = "requiredPermission";
export declare const RequirePermission: (permission: Permission) => import("@nestjs/common").CustomDecorator<string>;
export declare class PermissionsGuard implements CanActivate {
    private readonly reflector;
    constructor(reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}
