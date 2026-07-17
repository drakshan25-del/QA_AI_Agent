import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FindingClassification } from '../common/enums';

/** Persisted FailureClassificationOutput + defect draft (FR-RES-*, FR-BUG-*). */
@Entity('findings')
export class Finding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'execution_run_id', nullable: true })
  executionRunId!: string | null;

  @Column({ type: 'varchar', name: 'test_result_id', nullable: true })
  testResultId!: string | null;

  @Column({ type: 'varchar', default: 'inconclusive' })
  classification!: FindingClassification;

  @Column({ type: 'float', default: 0.5 })
  confidence!: number;

  @Column({ type: 'text', default: '' })
  rationale!: string;

  @Column({ type: 'varchar', default: 'medium' })
  severity!: string;

  @Column({ type: 'boolean', default: false })
  overridden!: boolean;

  @Column({ type: 'text', name: 'override_reason', default: '' })
  overrideReason!: string;

  @Column({ type: 'simple-json', name: 'defect_draft', nullable: true })
  defectDraft!: Record<string, unknown> | null;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
