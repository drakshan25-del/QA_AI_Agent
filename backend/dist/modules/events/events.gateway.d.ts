import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { Broadcaster, EventEnvelope, EventsService } from './events.service';
import { MembershipService } from '../../common/access/membership.service';
import { ExecutionRun } from '../../entities';
export declare class EventsGateway implements OnGatewayInit, OnGatewayConnection, Broadcaster, OnModuleInit {
    private readonly events;
    private readonly jwt;
    private readonly config;
    private readonly membership;
    private readonly runs;
    private readonly logger;
    server: Server;
    constructor(events: EventsService, jwt: JwtService, config: ConfigService, membership: MembershipService, runs: Repository<ExecutionRun>);
    onModuleInit(): void;
    afterInit(): void;
    handleConnection(client: Socket): Promise<void>;
    private extractToken;
    broadcast(envelope: EventEnvelope): void;
}
