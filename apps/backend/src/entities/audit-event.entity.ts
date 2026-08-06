import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Append-only audit trail; every mutation writes one (FR-AUD-001/004). */
@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', default: '' })
  actor!: string;

  @Column({ type: 'varchar', name: 'actor_id', nullable: true })
  actorId!: string | null;

  @Index()
  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', name: 'resource_type', default: '' })
  resourceType!: string;

  @Index()
  @Column({ type: 'varchar', name: 'resource_id', default: '' })
  resourceId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id', nullable: true })
  projectId!: string | null;

  /** success|failure|denied */
  @Column({ type: 'varchar', default: 'success' })
  result!: string;

  @Column({ type: 'varchar', name: 'correlation_id', default: '' })
  correlationId!: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
