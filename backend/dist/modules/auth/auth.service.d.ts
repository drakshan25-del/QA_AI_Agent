import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { PasswordService } from '../../common/crypto/password.service';
import { Role } from '../../common/enums';
import { RegisterDto } from './dto/auth.dto';
import { AuditService } from '../audit/audit.service';
export interface PublicUser {
    id: string;
    email: string;
    role: Role;
    name: string;
    createdAt: Date;
}
export declare class AuthService implements OnModuleInit {
    private readonly users;
    private readonly passwords;
    private readonly jwt;
    private readonly config;
    private readonly audit;
    private readonly logger;
    constructor(users: Repository<User>, passwords: PasswordService, jwt: JwtService, config: ConfigService, audit: AuditService);
    onModuleInit(): Promise<void>;
    toPublic(u: User): PublicUser;
    register(dto: RegisterDto, correlationId?: string): Promise<PublicUser>;
    private findWithHash;
    validateUser(email: string, password: string): Promise<User>;
    signAccess(user: User): string;
    signRefresh(user: User): string;
    login(email: string, password: string, correlationId?: string): Promise<{
        accessToken: string;
        refreshToken: string;
        user: PublicUser;
    }>;
    refresh(refreshToken: string): Promise<{
        accessToken: string;
    }>;
    me(userId: string): Promise<PublicUser>;
}
