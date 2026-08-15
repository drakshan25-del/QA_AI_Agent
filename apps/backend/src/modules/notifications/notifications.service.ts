import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities';
import { NotificationType } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
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

/**
 * In-app notifications (FR-V3-ENT-007 — mandatory in-app channel). Rows are
 * persisted per recipient and a `notification.new` envelope is broadcast on
 * the project stream so open clients update instantly.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly events: EventsService,
  ) {}

  async notify(input: NotifyInput): Promise<Notification | null> {
    if (!input.userId) return null;
    try {
      const saved = await this.repo.save(
        this.repo.create({
          userId: input.userId,
          projectId: input.projectId ?? null,
          type: input.type,
          title: input.title,
          message: input.message ?? '',
          resourceType: input.resourceType ?? '',
          resourceId: input.resourceId ?? '',
          read: false,
        }),
      );
      if (input.projectId) {
        // Delivered only to the recipient's own sockets (FR-V3-ENT-007):
        // notification content (e.g. failure detail) is per-user, not
        // project-wide broadcast material.
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
    } catch (err) {
      // Notification failure must never fail the underlying operation.
      this.logger.warn(`notify failed: ${(err as Error).message}`);
      return null;
    }
  }

  async listForUser(
    user: AuthUser,
    unreadOnly = false,
    limit = 50,
  ): Promise<Notification[]> {
    return this.repo.find({
      where: { userId: user.id, ...(unreadOnly ? { read: false } : {}) },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  async unreadCount(user: AuthUser): Promise<number> {
    return this.repo.count({ where: { userId: user.id, read: false } });
  }

  async markRead(id: string, user: AuthUser): Promise<Notification> {
    const n = await this.repo.findOne({ where: { id, userId: user.id } });
    if (!n) throw new NotFoundAppException(`Notification ${id} not found`);
    n.read = true;
    return this.repo.save(n);
  }

  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    const res = await this.repo.update(
      { userId: user.id, read: false },
      { read: true },
    );
    return { updated: res.affected ?? 0 };
  }
}
