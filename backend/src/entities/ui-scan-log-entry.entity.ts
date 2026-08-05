import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LogSeverity, UiScanStage } from '../common/enums';

/**
 * One live UI-scan log line (FR-UIS-004).
 *
 * Mirrors JobLogEntry and ExecutionLogEntry: entries stream to the browser as
 * `ui_scan.log` envelopes and are replayed from this table after a refresh or
 * a socket reconnect, deduplicated by `seq`, so a reloaded Analysis page
 * resumes the console without duplicates.
 *
 * Messages and meta are redacted before they are written, so no password,
 * token, cookie, authorization header or storage-state content can reach this
 * table (§4, SEC-007).
 */
@Entity('ui_scan_log_entries')
@Index(['scanId', 'seq'])
export class UiScanLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'scan_id' })
  scanId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Monotonic per-scan sequence for ordered replay + client-side dedup. */
  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', default: 'QUEUED' })
  stage!: UiScanStage;

  /** debug is stored as `info` severity with a `debug` level marker. */
  @Column({ type: 'varchar', default: 'info' })
  level!: LogSeverity | 'debug';

  @Column({ type: 'text', default: '' })
  message!: string;

  @Column({ type: 'int', nullable: true })
  progress!: number | null;

  @Column({ type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
