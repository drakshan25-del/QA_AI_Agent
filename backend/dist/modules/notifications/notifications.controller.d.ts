import { NotificationsService } from './notifications.service';
import { AuthUser } from '../../common/decorators';
export declare class NotificationsController {
    private readonly notifications;
    constructor(notifications: NotificationsService);
    list(user: AuthUser, unread?: string, limit?: string): Promise<import("../../entities").Notification[]>;
    unreadCount(user: AuthUser): Promise<{
        count: number;
    }>;
    markRead(id: string, user: AuthUser): Promise<import("../../entities").Notification>;
    markAllRead(user: AuthUser): Promise<{
        updated: number;
    }>;
}
