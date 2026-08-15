import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GenerationKind } from '../common/enums';

/** Audit-grade record of one generation invocation with hashes (§5). */
@Entity('generation_runs')
export class GenerationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar' })
  kind!: GenerationKind;

  @Column({ type: 'varchar', name: 'job_id', nullable: true })
  jobId!: string | null;

  @Column({ type: 'simple-json', name: 'input_refs', nullable: true })
  inputRefs!: Record<string, unknown> | null;

  @Column({ type: 'varchar', default: '' })
  model!: string;

  @Column({ type: 'float', default: 0.1 })
  temperature!: number;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'varchar', default: 'completed' })
  status!: string;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
