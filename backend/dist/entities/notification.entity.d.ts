import { NotificationType } from '../common/enums';
export declare class Notification {
    id: string;
    userId: string;
    projectId: string | null;
    type: NotificationType;
    title: string;
    message: string;
    resourceType: string;
    resourceId: string;
    read: boolean;
    createdAt: Date;
}
