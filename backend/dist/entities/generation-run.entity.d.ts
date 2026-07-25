import { GenerationKind } from '../common/enums';
export declare class GenerationRun {
    id: string;
    projectId: string;
    kind: GenerationKind;
    jobId: string | null;
    inputRefs: Record<string, unknown> | null;
    model: string;
    temperature: number;
    schemaVersion: string;
    contentHash: string;
    status: string;
    createdBy: string | null;
    createdAt: Date;
}
