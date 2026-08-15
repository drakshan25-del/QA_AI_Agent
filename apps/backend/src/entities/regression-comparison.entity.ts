import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Persisted baseline-vs-candidate run comparison (regression triad). */
@Entity('regression_comparisons')
export class RegressionComparison {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'baseline_run_id' })
  baselineRunId!: string;

  @Column({ type: 'varchar', name: 'candidate_run_id' })
  candidateRunId!: string;

  /** Full engine compare dict (transition lists + summary). */
  @Column({ type: 'simple-json' })
  result!: Record<string, unknown>;

  @Column({ type: 'boolean', name: 'has_regressions', default: false })
  hasRegressions!: boolean;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', name: 'correlation_id', nullable: true })
  correlationId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
