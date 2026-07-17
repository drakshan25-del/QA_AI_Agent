import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalStatus } from '../common/enums';

/** Persisted TestCaseOutput (FR-TC-*). */
@Entity('test_cases')
export class TestCase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'generation_run_id', nullable: true })
  generationRunId!: string | null;

  @Column({ type: 'simple-json', name: 'requirement_ids', nullable: true })
  requirementIds!: string[] | null;

  @Column({ type: 'varchar', name: 'case_key', default: '' })
  caseKey!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', default: '' })
  objective!: string;

  @Column({ type: 'varchar', default: 'positive' })
  category!: string;

  @Column({ type: 'varchar', default: 'medium' })
  priority!: string;

  @Column({ type: 'simple-json', nullable: true })
  preconditions!: string[] | null;

  @Column({ type: 'simple-json', name: 'test_data', nullable: true })
  testData!: Record<string, string> | null;

  @Column({ type: 'simple-json', nullable: true })
  steps!: string[] | null;

  @Column({ type: 'simple-json', name: 'expected_results', nullable: true })
  expectedResults!: string[] | null;

  @Column({ type: 'varchar', name: 'automation_suitability', default: 'automatable' })
  automationSuitability!: string;

  /** ai|manual */
  @Column({ type: 'varchar', default: 'ai' })
  source!: string;

  @Column({ type: 'varchar', name: 'approval_status', default: 'pending' })
  approvalStatus!: ApprovalStatus;

  @Column({ type: 'boolean', name: 'approval_invalidated', default: false })
  approvalInvalidated!: boolean;

  /** none|generated|approved|validated */
  @Column({ type: 'varchar', name: 'automation_status', default: 'none' })
  automationStatus!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
