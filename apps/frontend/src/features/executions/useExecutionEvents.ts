/**
 * useExecutionEvents — subscribes to the live execution stream for one run and
 * folds `execution.step`/`execution.status` envelopes into an ordered timeline
 * (FR-EXE-006/007/008). It seeds from persisted events (so a page load or a
 * completed run replays correctly, FR-EXE-010) and, on WS reconnect, refetches
 * events from `lastSeq` to close any gap (reconnect resume, FR-BE-004).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useSocket, type ConnectionStatus } from '../../hooks/useSocket';
import { executionsApi } from '../../services/api/endpoints';
import {
  initialTimelineState,
  timelineReducer,
  type TimelineState,
} from './executionTimeline';
import type { EventEnvelope, ExecutionEventRow, ExecutionStatus } from '../../services/api/types';

function rowToEnvelope(row: ExecutionEventRow): EventEnvelope {
  const payload =
    row.payload && typeof row.payload === 'object'
      ? row.payload
      : {
          testCaseId: row.testCaseId,
          testName: row.testName,
          sequence: row.sequence,
          actionType: row.actionType,
          target: row.target,
          valueSummary: row.valueSummary,
          status: row.status,
          currentUrl: row.currentUrl,
          elapsedMs: row.elapsedMs,
          ts: row.ts,
          evidenceUri: row.evidenceUri || undefined,
        };
  return {
    type: (row.type as EventEnvelope['type']) ?? 'execution.step',
    correlationId: '',
    projectId: row.projectId ?? '',
    runId: row.executionRunId,
    seq: row.seq,
    ts: row.ts || row.createdAt,
    payload,
  };
}

interface UseExecutionEventsResult {
  state: TimelineState;
  connection: ConnectionStatus;
}

export function useExecutionEvents(
  runId: string,
  projectId: string | undefined,
  options: { live?: boolean; initialStatus?: ExecutionStatus } = {},
): UseExecutionEventsResult {
  const live = options.live ?? true;
  const [state, dispatch] = useReducer(timelineReducer, initialTimelineState);
  const lastSeqRef = useRef(0);
  lastSeqRef.current = state.lastSeq;
  // Latest known run status without retriggering the seed effect: keying the
  // seed on `initialStatus` would blank and re-download the whole timeline on
  // every queued→running→passed transition mid-run.
  const initialStatusRef = useRef(options.initialStatus);
  initialStatusRef.current = options.initialStatus;

  // Seed persisted events once per run (replay), then keep live updates flowing.
  useEffect(() => {
    let cancelled = false;
    dispatch({ kind: 'reset' });
    (async () => {
      try {
        const rows = await executionsApi.events(runId, 0);
        if (cancelled) return;
        // Fold each persisted event through the reducer to preserve dedup/order.
        for (const row of rows) {
          dispatch({ kind: 'event', envelope: rowToEnvelope(row) });
        }
        const initialStatus = initialStatusRef.current;
        if (initialStatus) {
          dispatch({ kind: 'setStatus', status: initialStatus });
        }
      } catch {
        // No persisted events yet — the live stream will populate the timeline.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const handleEvent = useCallback(
    (envelope: EventEnvelope) => {
      if (envelope.runId && envelope.runId !== runId) return;
      dispatch({ kind: 'event', envelope });
    },
    [runId],
  );

  const handleReconnect = useCallback(() => {
    (async () => {
      try {
        const rows = await executionsApi.events(runId, lastSeqRef.current);
        for (const row of rows) {
          dispatch({ kind: 'event', envelope: rowToEnvelope(row) });
        }
      } catch {
        /* transient — next event or reconnect will recover */
      }
    })();
  }, [runId]);

  const { status } = useSocket({
    projectId,
    runId,
    enabled: live,
    onEvent: handleEvent,
    onReconnect: handleReconnect,
  });

  return { state, connection: status };
}
