import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalStatus } from '../common/enums';

/** Persisted TestPlanOutput (FR-TP-*). */
@Entity('test_plans')
export class TestPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'generation_run_id', nullable: true })
  generationRunId!: string | null;

  @Column({ type: 'varchar', default: '' })
  title!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', name: 'approval_status', default: 'pending' })
  approvalStatus!: ApprovalStatus;

  /** true when an upstream artefact change invalidated a prior approval (FR-VAL-007). */
  @Column({ type: 'boolean', name: 'approval_invalidated', default: false })
  approvalInvalidated!: boolean;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  /** TestPlanOutput sections (objectives, scope, exclusions, ...). */
  @Column({ type: 'simple-json' })
  sections!: Record<string, unknown>;

  @Column({ type: 'varchar', default: '' })
  model!: string;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
