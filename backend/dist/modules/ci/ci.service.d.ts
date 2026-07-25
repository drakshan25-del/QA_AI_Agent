import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ExecutionRun, GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { MembershipService } from '../../common/access/membership.service';
import { DispatchWorkflowDto } from './dto/ci.dto';
export declare class CiService {
    private readonly projects;
    private readonly artifacts;
    private readonly runs;
    private readonly membership;
    private readonly audit;
    private readonly events;
    private readonly config;
    private readonly logger;
    constructor(projects: Repository<Project>, artifacts: Repository<GeneratedArtifact>, runs: Repository<ExecutionRun>, membership: MembershipService, audit: AuditService, events: EventsService, config: ConfigService);
    private get githubToken();
    dispatch(dto: DispatchWorkflowDto, user: AuthUser, correlationId?: string): Promise<Record<string, unknown>>;
    getRun(id: string, user: AuthUser): Promise<ExecutionRun>;
    listRuns(projectId: string, user: AuthUser): Promise<ExecutionRun[]>;
    importRun(id: string, body: {
        metrics?: Record<string, unknown>;
        status?: string;
    }, user: AuthUser, correlationId?: string): Promise<ExecutionRun>;
}
