import { Role } from '../../../common/enums';
export declare class RegisterDto {
    email: string;
    password: string;
    role?: Role;
    name?: string;
}
export declare class LoginDto {
    email: string;
    password: string;
}
