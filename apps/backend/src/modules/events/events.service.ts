import { Injectable, Logger } from '@nestjs/common';
import { EventType } from '../../common/enums';

/** WS/SSE envelope (V2_CONTRACT §3). */
export interface EventEnvelope {
  type: EventType;
  correlationId: string;
  projectId: string;
  runId?: string;
  jobId?: string;
  /** When set, the envelope is delivered ONLY to this user's sockets
   * (per-recipient notifications, FR-V3-ENT-007) — never to project rooms. */
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

/** Something that can push an envelope to connected clients. */
export interface Broadcaster {
  broadcast(envelope: EventEnvelope): void;
}

/**
 * Central funnel for real-time events (FR-BE-004). Assigns a monotonic `seq`
 * per stream (per run when a runId is present, otherwise per project) so
 * clients can resume with `lastSeq`, builds the envelope, and hands it to the
 * registered broadcaster (the WS gateway).
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly seqByStream = new Map<string, number>();
  private broadcaster: Broadcaster | null = null;

  registerBroadcaster(b: Broadcaster): void {
    this.broadcaster = b;
  }

  private streamKey(projectId: string, runId?: string): string {
    return runId ? `run:${runId}` : `project:${projectId}`;
  }

  nextSeq(projectId: string, runId?: string): number {
    const key = this.streamKey(projectId, runId);
    const next = (this.seqByStream.get(key) ?? 0) + 1;
    this.seqByStream.set(key, next);
    return next;
  }

  /** Ensure the counter never goes backwards after a DB-driven replay. */
  primeSeq(projectId: string, runId: string | undefined, seq: number): void {
    const key = this.streamKey(projectId, runId);
    if ((this.seqByStream.get(key) ?? 0) < seq) {
      this.seqByStream.set(key, seq);
    }
  }

  emit(input: EmitInput): EventEnvelope {
    const seq = this.nextSeq(input.projectId, input.runId);
    const envelope: EventEnvelope = {
      type: input.type,
      correlationId: input.correlationId || '',
      projectId: input.projectId,
      runId: input.runId,
      jobId: input.jobId,
      userId: input.userId,
      seq,
      ts: new Date().toISOString(),
      payload: input.payload,
    };
    try {
      this.broadcaster?.broadcast(envelope);
    } catch (err) {
      this.logger.warn(
        `broadcast failed for ${envelope.type}: ${(err as Error).message}`,
      );
    }
    return envelope;
  }
}
