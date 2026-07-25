"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var EventsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventsService = void 0;
const common_1 = require("@nestjs/common");
let EventsService = EventsService_1 = class EventsService {
    constructor() {
        this.logger = new common_1.Logger(EventsService_1.name);
        this.seqByStream = new Map();
        this.broadcaster = null;
    }
    registerBroadcaster(b) {
        this.broadcaster = b;
    }
    streamKey(projectId, runId) {
        return runId ? `run:${runId}` : `project:${projectId}`;
    }
    nextSeq(projectId, runId) {
        const key = this.streamKey(projectId, runId);
        const next = (this.seqByStream.get(key) ?? 0) + 1;
        this.seqByStream.set(key, next);
        return next;
    }
    primeSeq(projectId, runId, seq) {
        const key = this.streamKey(projectId, runId);
        if ((this.seqByStream.get(key) ?? 0) < seq) {
            this.seqByStream.set(key, seq);
        }
    }
    emit(input) {
        const seq = this.nextSeq(input.projectId, input.runId);
        const envelope = {
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
        }
        catch (err) {
            this.logger.warn(`broadcast failed for ${envelope.type}: ${err.message}`);
        }
        return envelope;
    }
};
exports.EventsService = EventsService;
exports.EventsService = EventsService = EventsService_1 = __decorate([
    (0, common_1.Injectable)()
], EventsService);
//# sourceMappingURL=events.service.js.map