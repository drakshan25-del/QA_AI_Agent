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
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const events_service_1 = require("../events/events.service");
let NotificationsService = NotificationsService_1 = class NotificationsService {
    constructor(repo, events) {
        this.repo = repo;
        this.events = events;
        this.logger = new common_1.Logger(NotificationsService_1.name);
    }
    async notify(input) {
        if (!input.userId)
            return null;
        try {
            const saved = await this.repo.save(this.repo.create({
                userId: input.userId,
                projectId: input.projectId ?? null,
                type: input.type,
                title: input.title,
                message: input.message ?? '',
                resourceType: input.resourceType ?? '',
                resourceId: input.resourceId ?? '',
                read: false,
            }));
            if (input.projectId) {
                this.events.emit({
                    type: 'notification.new',
                    projectId: input.projectId,
                    userId: input.userId,
                    correlationId: input.correlationId,
                    payload: {
                        id: saved.id,
                        userId: saved.userId,
                        type: saved.type,
                        title: saved.title,
                        message: saved.message,
                        resourceType: saved.resourceType,
                        resourceId: saved.resourceId,
                        createdAt: saved.createdAt,
                    },
                });
            }
            return saved;
        }
        catch (err) {
            this.logger.warn(`notify failed: ${err.message}`);
            return null;
        }
    }
    async listForUser(user, unreadOnly = false, limit = 50) {
        return this.repo.find({
            where: { userId: user.id, ...(unreadOnly ? { read: false } : {}) },
            order: { createdAt: 'DESC' },
            take: Math.min(limit, 200),
        });
    }
    async unreadCount(user) {
        return this.repo.count({ where: { userId: user.id, read: false } });
    }
    async markRead(id, user) {
        const n = await this.repo.findOne({ where: { id, userId: user.id } });
        if (!n)
            throw new errors_1.NotFoundAppException(`Notification ${id} not found`);
        n.read = true;
        return this.repo.save(n);
    }
    async markAllRead(user) {
        const res = await this.repo.update({ userId: user.id, read: false }, { read: true });
        return { updated: res.affected ?? 0 };
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Notification)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        events_service_1.EventsService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map