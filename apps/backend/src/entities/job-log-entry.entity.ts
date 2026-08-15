import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LogSeverity } from '../common/enums';

/**
 * Persisted live-log entry for a long-running job (FR-V3-LOG-001..008).
 * Entries stream to the frontend as `job.log` envelopes and are replayed
 * from this table after a refresh or reconnect without duplication
 * (FR-V3-LOG-008). Messages are redacted before persistence (FR-V3-LOG-010).
 */
@Entity('job_log_entries')
export class JobLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'job_id' })
  jobId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Monotonic per-job sequence for ordered replay. */
  @Column({ type: 'int' })
  seq!: number;

  /** Current stage label, e.g. "requirement mapping", "persistence". */
  @Column({ type: 'varchar', default: '' })
  stage!: string;

  @Column({ type: 'text', default: '' })
  message!: string;

  @Column({ type: 'varchar', default: 'info' })
  severity!: LogSeverity;

  /** Determinate progress 0-100 when measurable, else null (§23.1.1). */
  @Column({ type: 'int', nullable: true })
  progress!: number | null;

  /** Expandable technical details for authorised users (no secrets). */
  @Column({ type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
