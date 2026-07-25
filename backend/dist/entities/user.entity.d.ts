import { Role } from '../common/enums';
export declare class User {
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
