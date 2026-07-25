import { RequirementsService } from './requirements.service';
import { CreateRequirementDto } from './dto/requirement.dto';
import { AuthUser } from '../../common/decorators';
export declare class RequirementsController {
    private readonly requirements;
    constructor(requirements: RequirementsService);
    create(projectId: string, dto: CreateRequirementDto, user: AuthUser, correlationId: string): Promise<import("../../entities").Requirement>;
    list(projectId: string, user: AuthUser): Promise<import("../../entities").Requirement[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").Requirement>;
    history(id: string, user: AuthUser): Promise<import("../../entities").AuditEvent[]>;
    versions(id: string, user: AuthUser): Promise<{
        version: number;
        contentHash: string;
        createdAt: Date;
    }[]>;
}
