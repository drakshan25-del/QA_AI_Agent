import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Persisted RequirementAnalysisOutput (FR-RA-*). */
@Entity('analyses')
export class Analysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'requirement_id', nullable: true })
  requirementId!: string | null;

  @Column({ type: 'varchar', name: 'generation_run_id', nullable: true })
  generationRunId!: string | null;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'int', name: 'risk_score', default: 5 })
  riskScore!: number;

  @Column({ type: 'simple-json' })
  output!: Record<string, unknown>;

  @Column({ type: 'varchar', default: '' })
  model!: string;

  @Column({ type: 'float', default: 0.1 })
  temperature!: number;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
