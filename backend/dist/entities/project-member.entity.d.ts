import { Role } from '../common/enums';
export declare class ProjectMember {
    id: string;
    projectId: string;
    userId: string;
    projectRole: Role;
    createdAt: Date;
}
