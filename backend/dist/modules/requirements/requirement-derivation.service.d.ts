import { Repository } from 'typeorm';
import { DocumentSegment, Requirement, SourceDocument } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
export declare class RequirementDerivationService {
    private readonly requirements;
    private readonly documents;
    private readonly segments;
    private readonly audit;
    private readonly logger;
    constructor(requirements: Repository<Requirement>, documents: Repository<SourceDocument>, segments: Repository<DocumentSegment>, audit: AuditService);
    deriveFromDocuments(projectId: string, documentIds: string[] | undefined, user: AuthUser, correlationId?: string): Promise<Requirement[]>;
    resolveGenerationScope(projectId: string, requirementIds: string[] | undefined, documentIds: string[] | undefined, user: AuthUser, correlationId?: string): Promise<Requirement[]>;
}
