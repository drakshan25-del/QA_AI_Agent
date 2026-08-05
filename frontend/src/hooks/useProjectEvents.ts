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
      // The bare project key is a PREFIX of every project-scoped query;
      // invalidating it non-exactly refetches documents, plans, cases,
      // coverage and more on every envelope. Only the project detail
      // (workflow summary) should refresh — exact match.
      const invalidateProjectDetail = () =>
        void qc.invalidateQueries({ queryKey: ['projects', projectId], exact: true });

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
          invalidateProjectDetail();
          break;
        case 'job.completed':
        case 'job.failed':
        case 'job.cancelled':
          invalidate(['projects', projectId, 'jobs']);
          invalidateProjectDetail();
          break;
        case 'job.progress':
          // Progress ticks arrive many times a minute; they change nothing
          // except the jobs list — never fan out wider (no refetch storm).
          invalidate(['projects', projectId, 'jobs']);
          break;
        case 'ui_scan.ready':
          // A finished scan changes the scan list, its elements and the
          // project's locator library; the live console handles its own
          // stream, so status ticks are deliberately not fanned out here.
          invalidate(['projects', projectId, 'ui-scans']);
          invalidate(['projects', projectId, 'locators']);
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
