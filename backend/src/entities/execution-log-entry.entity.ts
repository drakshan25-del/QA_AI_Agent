import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ExecutionLogLevel } from '../common/enums';

/**
 * Persisted real-time execution log entry (§ live execution logging).
 *
 * Mirrors JobLogEntry: entries stream to the frontend as `execution.log`
 * envelopes and are replayed from this table after a refresh or reconnect
 * without duplication (dedup by `seq`). Messages/meta are redacted before
 * persistence. Kept separate from ExecutionEvent (which carries fine-grained
 * step/status telemetry) so the human-facing console has its own clean,
 * ordered stream and vocabulary (stage + level + message).
 */
@Entity('execution_log_entries')
@Index(['executionRunId', 'seq'])
export class ExecutionLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'execution_run_id' })
  executionRunId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Monotonic per-run sequence for ordered replay + client-side dedup. */
  @Column({ type: 'int' })
  seq!: number;

  /** Lifecycle stage label, e.g. "Running Tests", "Capturing Evidence". */
  @Column({ type: 'varchar', default: '' })
  stage!: string;

  @Column({ type: 'varchar', default: 'info' })
  level!: ExecutionLogLevel;

  @Column({ type: 'text', default: '' })
  message!: string;

  /** Determinate progress 0-100 when measurable (e.g. test K of N), else null. */
  @Column({ type: 'int', nullable: true })
  progress!: number | null;

  /** Owning test for PASS/FAIL/test-level lines; empty for lifecycle lines. */
  @Column({ type: 'varchar', name: 'test_case_id', default: '' })
  testCaseId!: string;

  @Column({ type: 'varchar', name: 'test_name', default: '' })
  testName!: string;

  /** Expandable technical detail (stack trace, evidence paths) — no secrets. */
  @Column({ type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
