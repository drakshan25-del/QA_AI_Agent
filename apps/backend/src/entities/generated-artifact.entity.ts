import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalStatus, ArtifactStatus, ValidationStatus } from '../common/enums';

/** Persisted AutomationOutput file (FR-AUT-*). */
@Entity('generated_artifacts')
export class GeneratedArtifact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'generation_run_id', nullable: true })
  generationRunId!: string | null;

  @Column({ type: 'simple-json', name: 'test_case_ids', nullable: true })
  testCaseIds!: string[] | null;

  @Column({ type: 'varchar' })
  path!: string;

  /** test_file|page_object|fixture */
  @Column({ type: 'varchar', default: 'test_file' })
  kind!: string;

  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ type: 'text', default: '' })
  diff!: string;

  @Column({ type: 'simple-json', nullable: true })
  traceability!: Record<string, unknown> | null;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', default: 'active' })
  status!: ArtifactStatus;

  @Column({ type: 'varchar', name: 'superseded_by_id', nullable: true })
  supersededById!: string | null;

  @Column({ type: 'varchar', name: 'validation_status', default: 'pending' })
  validationStatus!: ValidationStatus;

  @Column({ type: 'simple-json', name: 'validation_report', nullable: true })
  validationReport!: Record<string, unknown> | null;

  @Column({ type: 'varchar', name: 'approval_status', default: 'pending' })
  approvalStatus!: ApprovalStatus;

  @Column({ type: 'boolean', name: 'approval_invalidated', default: false })
  approvalInvalidated!: boolean;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  /** ui|api — which generation flavour produced the file (CI marker algebra). */
  @Column({ type: 'varchar', name: 'test_type', default: 'ui' })
  testType!: string;

  @Column({ type: 'boolean', name: 'regression_suite', default: false })
  regressionSuite!: boolean;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
