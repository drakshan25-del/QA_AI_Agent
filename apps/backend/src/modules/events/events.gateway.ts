import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { Broadcaster, EventEnvelope, EventsService } from './events.service';
import { AppConfig } from '../../config/configuration';
import { MembershipService } from '../../common/access/membership.service';
import { AuthUser } from '../../common/decorators';
import { ExecutionRun } from '../../entities';

/**
 * WebSocket gateway at `/api/v2/events` (V2_CONTRACT §3). Clients connect with
 * `?projectId=&runId=` plus an access token (auth header or `auth.token` —
 * never the query string, SEC-007). Envelopes are pushed to project/run rooms
 * so a client only receives its scope; subscriptions are authorised against
 * project membership (FR-BE-004 "events are scoped to the correct
 * project/run"). Reconnect resume is supported via `lastSeq`/Last-Event-ID
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
    private readonly membership: MembershipService,
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
  ) {}

  onModuleInit(): void {
    this.events.registerBroadcaster(this);
  }

  afterInit(): void {
    this.logger.log('WS gateway ready at /api/v2/events');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    const secret = this.config.get<AppConfig['jwt']>('jwt')!.accessSecret;
    let user: AuthUser;
    try {
      const payload = this.jwt.verify(token, { secret });
      user = {
        id: payload.sub,
        email: payload.email ?? '',
        role: payload.role,
      } as AuthUser;
      (client.data as Record<string, unknown>).userId = user.id;
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
    try {
      // Subscriptions are authorised server-side: joining a project or run
      // room requires membership of that project (FR-BE-004, FR-V3-ENT-001).
      if (projectId) {
        await this.membership.ensureMember(projectId, user);
        void client.join(`project:${projectId}`);
      }
      if (runId) {
        const run = await this.runs.findOne({
          where: { id: runId },
          select: { id: true, projectId: true },
        });
        if (!run) throw new Error(`run ${runId} not found`);
        if (run.projectId !== projectId) {
          await this.membership.ensureMember(run.projectId, user);
        }
        void client.join(`run:${runId}`);
      }
    } catch {
      this.logger.warn(
        `WS rejected (not authorised for project/run scope) ${client.id}`,
      );
      client.emit('error', {
        code: 'forbidden',
        message: 'Not authorised for the requested project or run',
      });
      client.disconnect(true);
      return;
    }

    // Personal room for user-targeted envelopes (in-app notifications,
    // FR-V3-ENT-007) — never broadcast to whole-project rooms.
    void client.join(`user:${user.id}`);
    client.emit('subscribed', { projectId, runId });
  }

  private extractToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return '';
  }

  broadcast(envelope: EventEnvelope): void {
    if (!this.server) return;
    // User-targeted envelopes go only to that user's sockets (FR-V3-ENT-007);
    // everything else is scoped to the project/run rooms.
    if (envelope.userId) {
      this.server.to(`user:${envelope.userId}`).emit('event', envelope);
      return;
    }
    const rooms: string[] = [`project:${envelope.projectId}`];
    if (envelope.runId) rooms.push(`run:${envelope.runId}`);
    this.server.to(rooms).emit('event', envelope);
  }
}
