import { ProjectsService } from './projects.service';
import { AddMemberDto, CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { AuthUser } from '../../common/decorators';
export declare class ProjectsController {
    private readonly projects;
    constructor(projects: ProjectsService);
    create(dto: CreateProjectDto, user: AuthUser, correlationId: string): Promise<import("../../entities").Project>;
    list(user: AuthUser): Promise<import("../../entities").Project[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").Project & {
        workflowSummary: Record<string, unknown>;
    }>;
    update(id: string, dto: UpdateProjectDto, user: AuthUser, correlationId: string): Promise<import("../../entities").Project>;
    metrics(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    dashboard(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    export(id: string, user: AuthUser): Promise<Record<string, unknown>>;
    addMember(id: string, dto: AddMemberDto, user: AuthUser, correlationId: string): Promise<import("../../entities").ProjectMember>;
}
