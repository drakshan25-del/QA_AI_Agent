import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Browser, UiScanStage } from '../common/enums';
import { DATETIME_TYPE } from '../common/column-types';

/**
 * One UI Scanner run against a target application (FR-UIS-001).
 *
 * The row is the system of record for the scan: the engine owns the browser
 * and returns a result, this table owns the lifecycle, the counts, the
 * artefact locations and the research metrics (§29).
 *
 * Deliberately absent: credentials. The username and password entered in the
 * scan dialog are forwarded to the engine for a single sign-in and are never
 * persisted, logged or returned (§16, SEC-002).
 */
@Entity('ui_scans')
@Index(['projectId', 'createdAt'])
export class UiScan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar' })
  url!: string;

  /** URL the browser actually ended on, after login and any redirects. */
  @Column({ type: 'varchar', name: 'final_url', default: '' })
  finalUrl!: string;

  @Column({ type: 'varchar', name: 'page_title', default: '' })
  pageTitle!: string;

  @Column({ type: 'varchar', default: 'chromium' })
  browser!: Browser;

  @Column({ type: 'boolean', default: true })
  headless!: boolean;

  /** Current lifecycle stage; doubles as the scan status (§23.7 style). */
  @Column({ type: 'varchar', default: 'QUEUED' })
  status!: UiScanStage;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  /** Effective options the scan ran with (never includes credentials). */
  @Column({ type: 'simple-json', nullable: true })
  options!: Record<string, unknown> | null;

  @Column({ type: 'boolean', name: 'cancel_requested', default: false })
  cancelRequested!: boolean;

  @Column({ type: 'int', name: 'total_elements', default: 0 })
  totalElements!: number;

  @Column({ type: 'int', name: 'valid_locator_count', default: 0 })
  validLocatorCount!: number;

  @Column({ type: 'int', name: 'unresolved_count', default: 0 })
  unresolvedCount!: number;

  @Column({ type: 'int', name: 'frame_count', default: 0 })
  frameCount!: number;

  /** Pages visited by the crawl; 1 for a single-page scan (FR-UIS-015). */
  @Column({ type: 'int', name: 'page_count', default: 1 })
  pageCount!: number;

  @Column({ type: 'int', name: 'warning_count', default: 0 })
  warningCount!: number;

  @Column({ type: 'int', name: 'error_count', default: 0 })
  errorCount!: number;

  @Column({ type: 'int', name: 'approved_locator_count', default: 0 })
  approvedLocatorCount!: number;

  /** Research metrics for the dissertation evaluation (FR-UIS-029). */
  @Column({ type: 'simple-json', nullable: true })
  metrics!: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  frames!: Record<string, unknown>[] | null;

  @Column({ type: 'simple-json', nullable: true })
  warnings!: string[] | null;

  @Column({ type: 'text', name: 'error_message', default: '' })
  errorMessage!: string;

  /** Machine-readable failure envelope shown to the user (FR-UIS-027). */
  @Column({ type: 'simple-json', name: 'error_detail', nullable: true })
  errorDetail!: Record<string, unknown> | null;

  /**
   * Artefact file names *relative to this scan's own directory*. The absolute
   * path is derived server-side and never exposed to the browser (§23).
   */
  @Column({ type: 'varchar', name: 'screenshot_file', default: '' })
  screenshotFile!: string;

  @Column({ type: 'varchar', name: 'accessibility_snapshot_file', default: '' })
  accessibilitySnapshotFile!: string;

  /** Model actually used for the bounded fallback (never a silent default). */
  @Column({ type: 'varchar', name: 'selected_model', default: '' })
  selectedModel!: string;

  @Column({ type: 'boolean', default: false })
  authenticated!: boolean;

  @Column({ type: 'varchar', name: 'correlation_id', default: '' })
  correlationId!: string;

  @Column({ type: 'varchar', name: 'rescan_of_id', nullable: true })
  rescanOfId!: string | null;

  @Column({ type: 'varchar', name: 'schema_version', default: 'v1' })
  schemaVersion!: string;

  @Column({ type: DATETIME_TYPE, name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: DATETIME_TYPE, name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'int', name: 'duration_ms', nullable: true })
  durationMs!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
