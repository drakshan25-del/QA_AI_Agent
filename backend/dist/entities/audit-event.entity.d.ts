export declare class AuditEvent {
    id: string;
    actor: string;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    result: string;
    correlationId: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
}
