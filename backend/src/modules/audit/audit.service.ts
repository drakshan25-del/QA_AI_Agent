import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from '../../entities';
import { redact } from '../../common/redact';

export interface AuditInput {
  actor?: string;
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  projectId?: string | null;
  result?: 'success' | 'failure' | 'denied';
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/** Writes and queries the append-only audit trail (FR-AUD-001/004). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly repo: Repository<AuditEvent>,
  ) {}

  async record(input: AuditInput): Promise<AuditEvent> {
    const event = this.repo.create({
      actor: input.actor || 'system',
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType || '',
      resourceId: input.resourceId || '',
      projectId: input.projectId ?? null,
      result: input.result || 'success',
      correlationId: input.correlationId || '',
      metadata: input.metadata
        ? (redact(input.metadata) as Record<string, unknown>)
        : null,
    });
    const saved = await this.repo.save(event);
    this.logger.debug(
      `audit ${saved.action} ${saved.resourceType}:${saved.resourceId} → ${saved.result}`,
    );
    return saved;
  }

  async query(filter: {
    actor?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    projectId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AuditEvent[]; total: number }> {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (filter.actor) qb.andWhere('a.actor = :actor', { actor: filter.actor });
    if (filter.action)
      qb.andWhere('a.action = :action', { action: filter.action });
    if (filter.resourceType)
      qb.andWhere('a.resource_type = :rt', { rt: filter.resourceType });
    if (filter.resourceId)
      qb.andWhere('a.resource_id = :rid', { rid: filter.resourceId });
    if (filter.projectId)
      qb.andWhere('a.project_id = :pid', { pid: filter.projectId });
    if (filter.from) qb.andWhere('a.created_at >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('a.created_at <= :to', { to: filter.to });
    qb.take(Math.min(filter.limit ?? 100, 500)).skip(filter.offset ?? 0);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
