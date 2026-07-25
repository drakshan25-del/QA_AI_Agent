import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { AuthUser } from '../../common/decorators';
export interface AccessTokenPayload {
    sub: string;
    email: string;
    role: string;
    type: 'access';
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor(config: ConfigService);
    validate(payload: AccessTokenPayload): AuthUser;
}
export {};
