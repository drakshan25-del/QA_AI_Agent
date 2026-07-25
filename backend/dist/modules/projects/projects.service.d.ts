import { DataSource, Repository } from 'typeorm';
import { Project, ProjectMember } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
export declare class ProjectsService {
    private readonly projects;
    private readonly members;
    private readonly membership;
    private readonly audit;
    private readonly dataSource;
    constructor(projects: Repository<Project>, members: Repository<ProjectMember>, membership: MembershipService, audit: AuditService, dataSource: DataSource);
    create(dto: CreateProjectDto, user: AuthUser, correlationId?: string): Promise<Project>;
    findAllForUser(user: AuthUser): Promise<Project[]>;
    findOne(id: string, user: AuthUser): Promise<Project>;
    findOneWithSummary(id: string, user: AuthUser): Promise<Project & {
        workflowSummary: Record<string, unknown>;
    }>;
    private workflowSummary;
    private pendingApprovalsCount;
    dashboard(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    private pendingApprovalItems;
    update(id: string, dto: UpdateProjectDto, user: AuthUser, correlationId?: string): Promise<Project>;
    exportProject(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    metrics(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    addMember(projectId: string, userId: string, projectRole: AuthUser['role'], actor: AuthUser, correlationId?: string): Promise<ProjectMember>;
}
