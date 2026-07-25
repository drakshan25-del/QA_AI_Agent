import { DocumentsService } from './documents.service';
import { UpdateSegmentsDto } from './dto/document.dto';
import { AuthUser } from '../../common/decorators';
export declare class DocumentsController {
    private readonly documents;
    constructor(documents: DocumentsService);
    upload(projectId: string, files: Express.Multer.File[], body: Record<string, unknown>, user: AuthUser, correlationId: string): Promise<{
        documents: import("./documents.service").PerFileUploadResult[];
    }>;
    list(projectId: string, user: AuthUser): Promise<import("../../entities").SourceDocument[]>;
    get(id: string, user: AuthUser): Promise<import("../../entities").SourceDocument>;
    preview(id: string, user: AuthUser): Promise<{
        document: import("../../entities").SourceDocument;
        segments: import("../../entities").DocumentSegment[];
    }>;
    updateSegments(id: string, dto: UpdateSegmentsDto, user: AuthUser, correlationId: string): Promise<import("../../entities").DocumentSegment[]>;
    remove(id: string, user: AuthUser, correlationId: string): Promise<void>;
}
