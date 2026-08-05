/**
 * Live UI-scan subscription (FR-UIS-003/004).
 *
 * Mirrors the execution console's contract: persisted lines are replayed from
 * `GET .../ui-scans/:id/logs` on mount and after a socket reconnect,
 * deduplicated by `seq`, so a refreshed Analysis page resumes the console
 * without duplicates. Progress and the current stage come from `ui_scan.status`
 * envelopes produced by real backend stages — never from a frontend timer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { uiScannerApi } from '../../services/api/endpoints';
import { useSocket, type ConnectionStatus } from '../../hooks/useSocket';
import type {
  EventEnvelope,
  UiScanLogLevel,
  UiScanLogPayload,
  UiScanStage,
  UiScanStatusPayload,
} from '../../services/api/types';
import { UI_SCAN_TERMINAL_STAGES } from '../../services/api/types';

export interface UiScanLogRowView {
  seq: number;
  level: UiScanLogLevel;
  stage: UiScanStage;
  message: string;
  progress: number | null;
  meta?: Record<string, unknown> | null;
  ts: string;
}

export interface UiScanLiveState {
  stage: UiScanStage;
  progress: number;
  message: string;
  totalElements: number;
  validLocatorCount: number;
  unresolvedCount: number;
  frameCount: number;
  pageCount: number;
  warningCount: number;
  errorCount: number;
  startedAt: string | null;
}

const INITIAL: UiScanLiveState = {
  stage: 'IDLE',
  progress: 0,
  message: '',
  totalElements: 0,
  validLocatorCount: 0,
  unresolvedCount: 0,
  frameCount: 0,
  pageCount: 0,
  warningCount: 0,
  errorCount: 0,
  startedAt: null,
};

export function useUiScanStream({
  projectId,
  scanId,
  enabled,
  onFinished,
}: {
  projectId: string;
  scanId: string | null;
  enabled: boolean;
  onFinished?: (stage: UiScanStage) => void;
}): {
  logs: UiScanLogRowView[];
  live: UiScanLiveState;
  connection: ConnectionStatus;
  clearLogs: () => void;
} {
  const [logs, setLogs] = useState<UiScanLogRowView[]>([]);
  const [live, setLive] = useState<UiScanLiveState>(INITIAL);
  const lastSeqRef = useRef(0);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // Dedupe against `prev` itself, so StrictMode double-invocation and a
  // reconnect replay can never introduce duplicate lines.
  const append = useCallback((incoming: UiScanLogRowView[]) => {
    if (!incoming.length) return;
    setLogs((prev) => {
      const have = new Set(prev.map((r) => r.seq));
      const fresh = incoming.filter((r) => !have.has(r.seq));
      if (!fresh.length) return prev;
      const next = [...prev, ...fresh].sort((a, b) => a.seq - b.seq);
      lastSeqRef.current = next[next.length - 1]!.seq;
      return next;
    });
  }, []);

  const replay = useCallback(
    async (fromSeq: number) => {
      if (!scanId || !projectId) return;
      try {
        const rows = await uiScannerApi.logs(projectId, scanId, fromSeq);
        append(
          rows.map((r) => ({
            seq: r.seq,
            level: r.level,
            stage: r.stage,
            message: r.message,
            progress: r.progress,
            meta: r.meta,
            // Persisted rows carry `createdAt`; live payloads carry `ts`.
            ts: r.createdAt,
          })),
        );
      } catch {
        // Replay is best-effort; the live stream still delivers new lines.
      }
    },
    [projectId, scanId, append],
  );

  useEffect(() => {
    setLogs([]);
    setLive(INITIAL);
    lastSeqRef.current = 0;
    finishedRef.current = false;
    if (scanId) void replay(0);
  }, [scanId, replay]);

  const onEvent = useCallback(
    (envelope: EventEnvelope) => {
      if (!scanId) return;
      if (envelope.type === 'ui_scan.log') {
        const p = envelope.payload as unknown as UiScanLogPayload;
        if (p.scanId !== scanId) return;
        append([
          {
            seq: p.seq,
            level: p.level,
            stage: p.stage,
            message: p.message,
            progress: p.progress,
            meta: p.meta ?? null,
            ts: p.ts,
          },
        ]);
        return;
      }
      if (envelope.type === 'ui_scan.status') {
        const p = envelope.payload as unknown as UiScanStatusPayload;
        if (p.scanId !== scanId) return;
        setLive((prev) => ({
          stage: p.stage,
          progress: p.progress ?? prev.progress,
          message: p.message || prev.message,
          totalElements: p.totalElements ?? prev.totalElements,
          validLocatorCount: p.validLocatorCount ?? prev.validLocatorCount,
          unresolvedCount: p.unresolvedCount ?? prev.unresolvedCount,
          frameCount: p.frameCount ?? prev.frameCount,
          pageCount: p.pageCount ?? prev.pageCount,
          warningCount: p.warningCount ?? prev.warningCount,
          errorCount: p.errorCount ?? prev.errorCount,
          startedAt: p.startedAt ?? prev.startedAt,
        }));
        if (UI_SCAN_TERMINAL_STAGES.includes(p.stage) && !finishedRef.current) {
          finishedRef.current = true;
          onFinishedRef.current?.(p.stage);
        }
      }
    },
    [scanId, append],
  );

  const { status: connection } = useSocket({
    projectId,
    enabled: enabled && !!projectId && !!scanId,
    onEvent,
    onReconnect: () => void replay(lastSeqRef.current),
  });

  return { logs, live, connection, clearLogs: () => setLogs([]) };
}
