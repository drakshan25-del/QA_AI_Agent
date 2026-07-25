import { Role } from './enums';
export declare const IS_PUBLIC_KEY = "isPublic";
export declare const Public: () => import("@nestjs/common").CustomDecorator<string>;
export declare const ROLES_KEY = "roles";
export declare const Roles: (...roles: Role[]) => import("@nestjs/common").CustomDecorator<string>;
export interface AuthUser {
    id: string;
    email: string;
    role: Role;
}
export declare const CurrentUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
export declare const CorrelationId: (...dataOrPipes: unknown[]) => ParameterDecorator;
