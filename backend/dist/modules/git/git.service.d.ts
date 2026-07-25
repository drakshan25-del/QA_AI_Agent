import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { GitCommitDto } from './dto/git.dto';
export declare class GitService {
    private readonly projects;
    private readonly artifacts;
    private readonly membership;
    private readonly audit;
    private readonly config;
    private readonly logger;
    constructor(projects: Repository<Project>, artifacts: Repository<GeneratedArtifact>, membership: MembershipService, audit: AuditService, config: ConfigService);
    commit(projectId: string, dto: GitCommitDto, user: AuthUser, correlationId?: string): Promise<Record<string, unknown>>;
    private writeAndCommit;
    private exists;
}
