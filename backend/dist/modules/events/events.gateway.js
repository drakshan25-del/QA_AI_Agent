"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var EventsGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventsGateway = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const typeorm_1 = require("@nestjs/typeorm");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const typeorm_2 = require("typeorm");
const events_service_1 = require("./events.service");
const membership_service_1 = require("../../common/access/membership.service");
const entities_1 = require("../../entities");
let EventsGateway = EventsGateway_1 = class EventsGateway {
    constructor(events, jwt, config, membership, runs) {
        this.events = events;
        this.jwt = jwt;
        this.config = config;
        this.membership = membership;
        this.runs = runs;
        this.logger = new common_1.Logger(EventsGateway_1.name);
    }
    onModuleInit() {
        this.events.registerBroadcaster(this);
    }
    afterInit() {
        this.logger.log('WS gateway ready at /api/v2/events');
    }
    async handleConnection(client) {
        const token = this.extractToken(client);
        const secret = this.config.get('jwt').accessSecret;
        let user;
        try {
            const payload = this.jwt.verify(token, { secret });
            user = {
                id: payload.sub,
                email: payload.email ?? '',
                role: payload.role,
            };
            client.data.userId = user.id;
        }
        catch {
            this.logger.warn(`WS rejected (bad token) ${client.id}`);
            client.emit('error', { code: 'unauthorized', message: 'Invalid token' });
            client.disconnect(true);
            return;
        }
        const { projectId, runId } = client.handshake.query;
        try {
            if (projectId) {
                await this.membership.ensureMember(projectId, user);
                void client.join(`project:${projectId}`);
            }
            if (runId) {
                const run = await this.runs.findOne({
                    where: { id: runId },
                    select: { id: true, projectId: true },
                });
                if (!run)
                    throw new Error(`run ${runId} not found`);
                if (run.projectId !== projectId) {
                    await this.membership.ensureMember(run.projectId, user);
                }
                void client.join(`run:${runId}`);
            }
        }
        catch {
            this.logger.warn(`WS rejected (not authorised for project/run scope) ${client.id}`);
            client.emit('error', {
                code: 'forbidden',
                message: 'Not authorised for the requested project or run',
            });
            client.disconnect(true);
            return;
        }
        void client.join(`user:${user.id}`);
        client.emit('subscribed', { projectId, runId });
    }
    extractToken(client) {
        const auth = client.handshake.auth;
        if (auth?.token)
            return auth.token;
        const header = client.handshake.headers?.authorization;
        if (header?.startsWith('Bearer '))
            return header.slice(7);
        return '';
    }
    broadcast(envelope) {
        if (!this.server)
            return;
        if (envelope.userId) {
            this.server.to(`user:${envelope.userId}`).emit('event', envelope);
            return;
        }
        const rooms = [`project:${envelope.projectId}`];
        if (envelope.runId)
            rooms.push(`run:${envelope.runId}`);
        this.server.to(rooms).emit('event', envelope);
    }
};
exports.EventsGateway = EventsGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], EventsGateway.prototype, "server", void 0);
exports.EventsGateway = EventsGateway = EventsGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        path: '/api/v2/events',
        cors: { origin: true, credentials: true },
    }),
    __param(4, (0, typeorm_1.InjectRepository)(entities_1.ExecutionRun)),
    __metadata("design:paramtypes", [events_service_1.EventsService,
        jwt_1.JwtService,
        config_1.ConfigService,
        membership_service_1.MembershipService,
        typeorm_2.Repository])
], EventsGateway);
//# sourceMappingURL=events.gateway.js.map