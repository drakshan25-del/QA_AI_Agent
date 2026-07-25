export declare class DocumentSegment {
    id: string;
    documentId: string;
    sequence: number;
    pageOrSheet: string;
    rowOrSection: string;
    content: string;
    metadata: Record<string, unknown> | null;
    inclusionStatus: string;
    createdAt: Date;
}
