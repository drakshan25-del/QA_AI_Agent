import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionMode, ExecutionStatus } from '../common/enums';
import { DATETIME_TYPE } from '../common/column-types';

@Entity('execution_runs')
export class ExecutionRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', default: 'local' })
  mode!: ExecutionMode;

  @Column({ type: 'varchar', default: 'queued' })
  status!: ExecutionStatus;

  @Column({ type: 'varchar', default: 'local' })
  environment!: string;

  @Column({ type: 'varchar', default: 'chromium' })
  browser!: string;

  @Column({ type: 'boolean', default: false })
  headed!: boolean;

  @Column({ type: 'simple-json', name: 'automation_ids', nullable: true })
  automationIds!: string[] | null;

  @Column({ type: 'simple-json', name: 'test_paths', nullable: true })
  testPaths!: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  metrics!: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  evidence!: Record<string, unknown> | null;

  @Column({ type: 'varchar', name: 'ci_run_id', default: '' })
  ciRunId!: string;

  @Column({ type: 'varchar', name: 'ci_url', default: '' })
  ciUrl!: string;

  @Column({ type: 'varchar', name: 'correlation_id', default: '' })
  correlationId!: string;

  @Column({ type: 'simple-json', nullable: true })
  report!: Record<string, unknown> | null;

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
