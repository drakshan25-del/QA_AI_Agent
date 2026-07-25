import { Repository } from 'typeorm';
import { Requirement } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../../entities';
import { MembershipService } from '../../common/access/membership.service';
import { CreateRequirementDto } from './dto/requirement.dto';
export declare class RequirementsService {
    private readonly requirements;
    private readonly auditEvents;
    private readonly membership;
    private readonly audit;
    constructor(requirements: Repository<Requirement>, auditEvents: Repository<AuditEvent>, membership: MembershipService, audit: AuditService);
    create(projectId: string, dto: CreateRequirementDto, user: AuthUser, correlationId?: string): Promise<Requirement>;
    listByProject(projectId: string, user: AuthUser): Promise<Requirement[]>;
    getOne(id: string, user: AuthUser): Promise<Requirement>;
    history(id: string, user: AuthUser): Promise<AuditEvent[]>;
    versions(id: string, user: AuthUser): Promise<{
        version: number;
        contentHash: string;
        createdAt: Date;
    }[]>;
}
