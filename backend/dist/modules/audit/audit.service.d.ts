import { Repository } from 'typeorm';
import { AuditEvent } from '../../entities';
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
export declare class AuditService {
    private readonly repo;
    private readonly logger;
    constructor(repo: Repository<AuditEvent>);
    record(input: AuditInput): Promise<AuditEvent>;
    query(filter: {
        actor?: string;
        action?: string;
        resourceType?: string;
        resourceId?: string;
        projectId?: string;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        items: AuditEvent[];
        total: number;
    }>;
}
