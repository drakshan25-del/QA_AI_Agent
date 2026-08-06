import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, AuthUser } from '../decorators';
import { Role } from '../enums';
import { ForbiddenAppException } from '../errors';

/** Enforces @Roles(...) route metadata (V2_CONTRACT §1, FR-BE-002). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as
      | AuthUser
      | undefined;
    if (!user) throw new ForbiddenAppException('No authenticated user');
    // admin is a superuser across roles.
    if (user.role === 'admin' || required.includes(user.role)) return true;
    throw new ForbiddenAppException(
      `Requires one of roles: ${required.join(', ')}`,
    );
  }
}
