import { EventType } from '../../common/enums';
export interface EventEnvelope {
    type: EventType;
    correlationId: string;
    projectId: string;
    runId?: string;
    jobId?: string;
    userId?: string;
    seq: number;
    ts: string;
    payload: Record<string, unknown>;
}
export interface EmitInput {
    type: EventType;
    projectId: string;
    runId?: string;
    jobId?: string;
    userId?: string;
    correlationId?: string;
    payload: Record<string, unknown>;
}
export interface Broadcaster {
    broadcast(envelope: EventEnvelope): void;
}
export declare class EventsService {
    private readonly logger;
    private readonly seqByStream;
    private broadcaster;
    registerBroadcaster(b: Broadcaster): void;
    private streamKey;
    nextSeq(projectId: string, runId?: string): number;
    primeSeq(projectId: string, runId: string | undefined, seq: number): void;
    emit(input: EmitInput): EventEnvelope;
}
