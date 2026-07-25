import { Repository } from 'typeorm';
import { Notification } from '../../entities';
import { NotificationType } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { EventsService } from '../events/events.service';
export interface NotifyInput {
    userId: string;
    projectId?: string | null;
    type: NotificationType;
    title: string;
    message?: string;
    resourceType?: string;
    resourceId?: string;
    correlationId?: string;
}
export declare class NotificationsService {
    private readonly repo;
    private readonly events;
    private readonly logger;
    constructor(repo: Repository<Notification>, events: EventsService);
    notify(input: NotifyInput): Promise<Notification | null>;
    listForUser(user: AuthUser, unreadOnly?: boolean, limit?: number): Promise<Notification[]>;
    unreadCount(user: AuthUser): Promise<number>;
    markRead(id: string, user: AuthUser): Promise<Notification>;
    markAllRead(user: AuthUser): Promise<{
        updated: number;
    }>;
}
