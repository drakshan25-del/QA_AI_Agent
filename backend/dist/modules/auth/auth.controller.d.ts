import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { AuthUser } from '../../common/decorators';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    private setRefreshCookie;
    register(dto: RegisterDto, correlationId: string): Promise<import("./auth.service").PublicUser>;
    login(dto: LoginDto, res: Response, correlationId: string): Promise<{
        accessToken: string;
        user: import("./auth.service").PublicUser;
    }>;
    refresh(req: Request): Promise<{
        accessToken: string;
    }>;
    logout(res: Response): Promise<void>;
    me(user: AuthUser): Promise<import("./auth.service").PublicUser>;
}
