import { Repository } from 'typeorm';
import { Project, ProjectMember } from '../../entities';
import { AuthUser } from '../decorators';
import { Role } from '../enums';
export declare class MembershipService {
    private readonly projects;
    private readonly members;
    constructor(projects: Repository<Project>, members: Repository<ProjectMember>);
    getProjectOr404(projectId: string): Promise<Project>;
    isMember(projectId: string, userId: string): Promise<boolean>;
    ensureMember(projectId: string, user: AuthUser): Promise<void>;
    addMember(projectId: string, userId: string, projectRole: Role): Promise<ProjectMember>;
}
