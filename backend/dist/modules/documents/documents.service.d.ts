import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { DocumentSegment, SourceDocument } from '../../entities';
import { DocumentCategory } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { UploadedFileLike } from './file-validation';
export interface PerFileUploadResult {
    filename: string;
    category: string;
    status: 'accepted' | 'rejected';
    documentId?: string;
    parseStatus?: string;
    segments?: number;
    reason?: string;
}
export declare class DocumentsService {
    private readonly documents;
    private readonly segments;
    private readonly membership;
    private readonly audit;
    private readonly engine;
    private readonly config;
    private readonly logger;
    constructor(documents: Repository<SourceDocument>, segments: Repository<DocumentSegment>, membership: MembershipService, audit: AuditService, engine: EngineClient, config: ConfigService);
    private get maxBytes();
    private get uploadDir();
    upload(projectId: string, files: UploadedFileLike[], categories: DocumentCategory[], user: AuthUser, correlationId?: string): Promise<PerFileUploadResult[]>;
    private persistFile;
    listByProject(projectId: string, user: AuthUser): Promise<SourceDocument[]>;
    getOne(id: string, user: AuthUser): Promise<SourceDocument>;
    preview(id: string, user: AuthUser): Promise<{
        document: SourceDocument;
        segments: DocumentSegment[];
    }>;
    updateSegments(id: string, updates: {
        segmentId: string;
        inclusionStatus: 'included' | 'excluded';
    }[], user: AuthUser, correlationId?: string): Promise<DocumentSegment[]>;
    remove(id: string, user: AuthUser, correlationId?: string): Promise<void>;
}
