import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApprovalStatus } from '../common/enums';

/**
 * Integer-based test-plan revision history (FR-V3-TP-001/002/003). The first
 * saved plan is v1; every subsequent save appends v2, v3, ... — numbers are
 * never reused. Each revision snapshots the full sections payload so earlier
 * revisions can be compared side-by-side and restored.
 */
@Entity('test_plan_revisions')
@Unique(['testPlanId', 'version'])
export class TestPlanRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'test_plan_id' })
  testPlanId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Revision number rendered as v{int} (FR-V3-TP-001). */
  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', default: '' })
  title!: string;

  /** Full snapshot of the plan sections at this revision. */
  @Column({ type: 'simple-json' })
  sections!: Record<string, unknown>;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  /** What produced the revision: generated | edited | restored (FR-V3-TP-002). */
  @Column({ type: 'varchar', name: 'source_action', default: 'edited' })
  sourceAction!: string;

  @Column({ type: 'varchar', name: 'change_summary', default: '' })
  changeSummary!: string;

  @Column({ type: 'varchar', name: 'approval_status', default: 'pending' })
  approvalStatus!: ApprovalStatus;

  @Column({ type: 'varchar', default: '' })
  author!: string;

  @Column({ type: 'varchar', name: 'author_id', nullable: true })
  authorId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
