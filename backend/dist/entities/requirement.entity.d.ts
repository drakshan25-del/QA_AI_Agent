export declare class Requirement {
    id: string;
    projectId: string;
    source: string;
    version: number;
    title: string;
    text: string;
    acceptanceCriteria: string[] | null;
    status: string;
    sourceDocumentId: string | null;
    contentHash: string;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
