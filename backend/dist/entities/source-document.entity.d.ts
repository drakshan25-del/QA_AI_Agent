import { DocumentCategory } from '../common/enums';
export declare class SourceDocument {
    id: string;
    projectId: string;
    filename: string;
    category: DocumentCategory;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    parseStatus: string;
    message: string;
    storagePath: string;
    contentHash: string;
    uploadedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
