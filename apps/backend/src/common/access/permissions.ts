/**
 * Role-based access control (FR-V3-ENT-001). Every protected action is
 * authorised server-side against this map; denied actions return a clear
 * 403 with the required permission name. `admin` is a superuser.
 *
 * Roles: admin, qa_lead, qa_engineer, automation_engineer, developer,
 * reviewer, viewer (+ legacy V2 roles supervisor/devops kept working).
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../decorators';
import { Role } from '../enums';
import { ForbiddenAppException } from '../errors';

export type Permission =
  | 'project.write'
  | 'document.upload'
  | 'generation.run'
  | 'artefact.edit'
  | 'approval.decide'
  | 'execution.run'
  | 'execution.control'
  | 'regression.compare'
  | 'git.push'
  | 'ci.trigger'
  | 'classification.override'
  | 'report.export'
  | 'admin.manage'
  | 'accounts.manage';

const ALL_EDIT_ROLES: Role[] = [
  'admin',
  'qa_lead',
  'qa_engineer',
  'automation_engineer',
  'supervisor',
  'devops',
];

/** Which roles hold each permission (viewer holds none — read-only). */
export const PERMISSION_ROLES: Record<Permission, Role[]> = {
  'project.write': ALL_EDIT_ROLES,
  'document.upload': [...ALL_EDIT_ROLES, 'developer'],
  'generation.run': ALL_EDIT_ROLES,
  'artefact.edit': ALL_EDIT_ROLES,
  'approval.decide': ['admin', 'qa_lead', 'reviewer', 'supervisor'],
  'execution.run': ALL_EDIT_ROLES,
  'execution.control': ALL_EDIT_ROLES,
  'regression.compare': ALL_EDIT_ROLES,
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
  // Account enable/disable is reserved for the platform owner — admins are
  // deliberately excluded from this one.
  'accounts.manage': ['superowner'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === 'superowner') return true;
  if (role === 'admin') return permission !== 'accounts.manage';
  return (PERMISSION_ROLES[permission] ?? []).includes(role);
}

/** Roles with platform-wide (cross-project) visibility. */
export function isAdminRole(role: Role): boolean {
  return role === 'admin' || role === 'superowner';
}

export const PERMISSION_KEY = 'requiredPermission';
/** Restricts a route to roles holding the given permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const user = context.switchToHttp().getRequest().user as
      | AuthUser
      | undefined;
    if (!user) throw new ForbiddenAppException('No authenticated user');
    if (hasPermission(user.role, permission)) return true;
    throw new ForbiddenAppException(
      `Your role (${user.role}) does not include the "${permission}" permission.`,
      { permission, role: user.role },
    );
  }
}
