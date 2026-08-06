import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalDecision, ApprovalResourceType } from '../common/enums';

/** Human-in-the-loop approval record (FR-HITL-*, FR-AUD-*). */
@Entity('approvals')
export class Approval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'resource_type' })
  resourceType!: ApprovalResourceType;

  @Index()
  @Column({ type: 'varchar', name: 'resource_id' })
  resourceId!: string;

  /** Artefact version this decision was made against (FR-VAL-007). */
  @Column({ type: 'int', name: 'resource_version', default: 1 })
  resourceVersion!: number;

  @Column({ type: 'varchar' })
  decision!: ApprovalDecision;

  @Column({ type: 'text', default: '' })
  comment!: string;

  /** true once a later upstream change invalidated this decision. */
  @Column({ type: 'boolean', default: false })
  invalidated!: boolean;

  @Column({ type: 'varchar', name: 'actor_id', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', default: '' })
  actor!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
