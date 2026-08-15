import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Persisted ordered live execution event (FR-EXE-006/007/008). */
@Entity('execution_events')
@Index(['executionRunId', 'seq'])
export class ExecutionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'execution_run_id' })
  executionRunId!: string;

  @Column({ type: 'varchar', name: 'project_id', nullable: true })
  projectId!: string | null;

  /** Monotonic sequence within the run (reconnect resume, FR-BE-004). */
  @Column({ type: 'int', default: 0 })
  seq!: number;

  /** WS envelope type: execution.step | execution.status */
  @Column({ type: 'varchar', default: 'execution.step' })
  type!: string;

  @Column({ type: 'varchar', name: 'test_case_id', default: '' })
  testCaseId!: string;

  @Column({ type: 'varchar', name: 'test_name', default: '' })
  testName!: string;

  @Column({ type: 'int', default: 0 })
  sequence!: number;

  @Column({ type: 'varchar', name: 'action_type', default: '' })
  actionType!: string;

  @Column({ type: 'varchar', default: '' })
  target!: string;

  @Column({ type: 'varchar', name: 'value_summary', default: '' })
  valueSummary!: string;

  /** running|passed|failed|skipped (or run status for execution.status) */
  @Column({ type: 'varchar', default: '' })
  status!: string;

  @Column({ type: 'varchar', name: 'current_url', default: '' })
  currentUrl!: string;

  @Column({ type: 'int', name: 'elapsed_ms', default: 0 })
  elapsedMs!: number;

  @Column({ type: 'varchar', name: 'evidence_uri', default: '' })
  evidenceUri!: string;

  @Column({ type: 'varchar', default: '' })
  ts!: string;

  /** Full raw payload as received/forwarded. */
  @Column({ type: 'simple-json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
