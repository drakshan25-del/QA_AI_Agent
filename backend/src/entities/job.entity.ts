import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobStatus, JobType } from '../common/enums';
import { DATETIME_TYPE } from '../common/column-types';

/** Async generation job (correlation id + idempotency, FR-BE-006, NFR-PERF-001). */
@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar' })
  type!: JobType;

  @Column({ type: 'varchar', default: 'queued' })
  status!: JobStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ type: 'varchar', name: 'correlation_id', default: '' })
  correlationId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'simple-json', name: 'input_refs', nullable: true })
  inputRefs!: Record<string, unknown> | null;

  @Column({ type: 'simple-json', name: 'result_refs', nullable: true })
  resultRefs!: Record<string, unknown> | null;

  @Column({ type: 'text', default: '' })
  error!: string;

  @Column({ type: DATETIME_TYPE, name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: DATETIME_TYPE, name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
