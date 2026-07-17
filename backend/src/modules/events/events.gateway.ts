import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Broadcaster, EventEnvelope, EventsService } from './events.service';
import { AppConfig } from '../../config/configuration';

/**
 * WebSocket gateway at `/api/v2/events` (V2_CONTRACT §3). Clients connect with
 * `?projectId=&runId=` plus an access token (auth header, `auth.token`, or
 * `?token=`). Envelopes are pushed to project/run rooms so a client only
 * receives its scope. Reconnect resume is supported via `lastSeq`/Last-Event-ID
 * for execution runs (the executions service replays persisted events).
 */
@WebSocketGateway({
  path: '/api/v2/events',
  cors: { origin: true, credentials: true },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, Broadcaster, OnModuleInit
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.events.registerBroadcaster(this);
  }

  afterInit(): void {
    this.logger.log('WS gateway ready at /api/v2/events');
  }

  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    const secret = this.config.get<AppConfig['jwt']>('jwt')!.accessSecret;
    try {
      const payload = this.jwt.verify(token, { secret });
      (client.data as Record<string, unknown>).userId = payload.sub;
    } catch {
      this.logger.warn(`WS rejected (bad token) ${client.id}`);
      client.emit('error', { code: 'unauthorized', message: 'Invalid token' });
      client.disconnect(true);
      return;
    }

    const { projectId, runId } = client.handshake.query as Record<
      string,
      string | undefined
    >;
    if (projectId) void client.join(`project:${projectId}`);
    if (runId) void client.join(`run:${runId}`);
    client.emit('subscribed', { projectId, runId });
  }

  private extractToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const q = client.handshake.query?.token;
    return typeof q === 'string' ? q : '';
  }

  broadcast(envelope: EventEnvelope): void {
    if (!this.server) return;
    const rooms: string[] = [`project:${envelope.projectId}`];
    if (envelope.runId) rooms.push(`run:${envelope.runId}`);
    this.server.to(rooms).emit('event', envelope);
  }
}
