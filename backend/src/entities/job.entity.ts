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

  /** Set by POST /jobs/{id}/cancel; workers stop at the next checkpoint (FR-V3-LOG-009). */
  @Column({ type: 'boolean', name: 'cancel_requested', default: false })
  cancelRequested!: boolean;

  /** When this job is a retry, the job it retries (FR-V3-LOG-009 traceability). */
  @Column({ type: 'varchar', name: 'retry_of_job_id', nullable: true })
  retryOfJobId!: string | null;

  /** Current stage label mirrored from the latest log entry (§23.1.1). */
  @Column({ type: 'varchar', name: 'current_stage', default: '' })
  currentStage!: string;

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
