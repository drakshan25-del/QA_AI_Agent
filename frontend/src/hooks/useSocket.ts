/**
 * Shared socket.io connection to the backend WS gateway at `/api/v2/events`
 * (V2_CONTRACT §3; the backend gateway is a NestJS socket.io server). The
 * client authenticates with the in-memory access token and joins the
 * project/run rooms via the handshake query. The server emits envelopes on the
 * `'event'` channel. Reconnects are automatic; `Last-Event-ID`/lastSeq resume
 * is handled by the consumer refetching persisted events on reconnect.
 */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ensureFreshToken } from '../services/api/client';
import { config } from '../services/api/config';
import type { EventEnvelope } from '../services/api/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface UseSocketOptions {
  projectId?: string;
  runId?: string;
  enabled?: boolean;
  onEvent: (envelope: EventEnvelope) => void;
  onReconnect?: () => void;
}

export function useSocket({
  projectId,
  runId,
  enabled = true,
  onEvent,
  onReconnect,
}: UseSocketOptions): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  // Keep the latest callbacks without forcing socket re-creation.
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }
    const query: Record<string, string> = {};
    if (projectId) query.projectId = projectId;
    if (runId) query.runId = runId;

    // Room scope comes from the handshake query, so each scope needs its own
    // socket (forceNew) — but auth MUST be a function: socket.io re-invokes it
    // on every (re)connect. It resolves through `ensureFreshToken`, which
    // refreshes an expired or nearly-expired token *before* handing it over;
    // reading the store directly would replay the stale JWT on every retry and
    // the gateway would reject the handshake until some unrelated HTTP request
    // happened to refresh it. The token never goes in the query string (it
    // would end up in proxy and access logs, SEC-007).
    const socket: Socket = io(config.wsBase, {
      path: '/api/v2/events',
      transports: ['websocket'],
      withCredentials: true,
      forceNew: true,
      auth: (cb) => {
        void ensureFreshToken().then((token) => cb({ token: token ?? '' }));
      },
      query,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    setStatus('connecting');
    let hadFirstConnect = false;

    socket.on('connect', () => {
      setStatus('connected');
      if (hadFirstConnect) onReconnectRef.current?.();
      hadFirstConnect = true;
    });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));
    socket.on('event', (envelope: EventEnvelope) => {
      onEventRef.current(envelope);
    });

    return () => {
      socket.off('event');
      socket.disconnect();
    };
  }, [projectId, runId, enabled]);

  return { status };
}
