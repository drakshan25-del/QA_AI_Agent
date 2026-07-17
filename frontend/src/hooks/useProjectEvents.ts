/**
 * Project-scoped realtime subscription. Folds `job.*`, `*.ready` and
 * `approval.updated` envelopes (V2_CONTRACT §3) into react-query cache
 * invalidations so project pages refresh live as agents finish work — no
 * polling. Also surfaces the most recent envelope for lightweight banners.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket, type ConnectionStatus } from './useSocket';
import type { EventEnvelope } from '../services/api/types';

export function useProjectEvents(
  projectId: string | undefined,
  enabled = true,
): { last: EventEnvelope | null; connection: ConnectionStatus } {
  const qc = useQueryClient();
  const [last, setLast] = useState<EventEnvelope | null>(null);

  const onEvent = useCallback(
    (envelope: EventEnvelope) => {
      setLast(envelope);
      if (!projectId) return;
      const invalidate = (key: unknown[]) =>
        void qc.invalidateQueries({ queryKey: key });

      switch (envelope.type) {
        case 'analysis.ready':
          invalidate(['projects', projectId, 'analyses']);
          break;
        case 'plan.ready':
          invalidate(['projects', projectId, 'test-plans']);
          break;
        case 'cases.ready':
          invalidate(['projects', projectId, 'test-cases']);
          invalidate(['projects', projectId, 'coverage']);
          break;
        case 'automation.ready':
        case 'validation.ready':
          invalidate(['projects', projectId, 'automation']);
          break;
        case 'approval.updated':
          invalidate(['projects', projectId, 'test-plans']);
          invalidate(['projects', projectId, 'test-cases']);
          invalidate(['projects', projectId, 'automation']);
          invalidate(['projects', projectId]);
          break;
        case 'job.completed':
        case 'job.failed':
        case 'job.cancelled':
        case 'job.progress':
          invalidate(['projects', projectId, 'jobs']);
          invalidate(['projects', projectId]);
          break;
        case 'notification.new':
          invalidate(['notifications']);
          break;
        case 'ci.status':
          invalidate(['ci', projectId]);
          break;
        default:
          break;
      }
    },
    [projectId, qc],
  );

  const { status } = useSocket({ projectId, enabled: enabled && !!projectId, onEvent });
  return { last, connection: status };
}
