import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('test_results')
export class TestResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'execution_run_id' })
  executionRunId!: string;

  @Column({ type: 'varchar', name: 'test_case_id', nullable: true })
  testCaseId!: string | null;

  @Column({ type: 'varchar', name: 'node_id', default: '' })
  nodeId!: string;

  /** passed|failed|skipped|error */
  @Column({ type: 'varchar', default: 'passed' })
  outcome!: string;

  @Column({ type: 'float', name: 'duration_seconds', default: 0 })
  durationSeconds!: number;

  @Column({ type: 'text', name: 'error_message', default: '' })
  errorMessage!: string;

  @Column({ type: 'simple-json', nullable: true })
  evidence!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
