import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATETIME_TYPE } from '../common/column-types';
import {
  LocatorSource,
  LocatorStatus,
  LocatorStrategy,
} from '../common/enums';

/**
 * A locator the team has accepted for a project page (FR-UIS-021).
 *
 * This is the hand-off point between the UI Scanner and automation
 * generation: the generator looks a locator up here by page and element intent
 * instead of inventing a selector (FR-UIS-025).
 *
 * `locatorData` is the machine-readable form the execution and validation
 * layers rebuild through the Playwright API; `expression` and
 * `pythonExpression` are the displayable code. The expression string is never
 * executed — nothing in this system turns a stored string into code (SEC-005).
 *
 * Versioning: approving a new locator for the same element supersedes the
 * previous row (`active = false`) rather than overwriting it, so a locator's
 * history — and a future self-healing proposal — stays auditable
 * (FR-UIS-026).
 */
@Entity('locator_records')
@Index(['projectId', 'active'])
@Index(['projectId', 'pageUrlPattern', 'elementName'])
// Resolution reads the library by project + page + approval on every generated
// step, so that lookup gets its own composite index (FR-UIS-025 §17).
@Index(['projectId', 'active', 'approved', 'pageUrlPattern'])
@Index(['projectId', 'elementKey', 'active'])
@Index(['projectId', 'frameKey', 'active'])
export class LocatorRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'scan_id', nullable: true })
  scanId!: string | null;

  @Column({ type: 'varchar', name: 'scanned_element_id', nullable: true })
  scannedElementId!: string | null;

  /** Stable element identity, carried over from the scan (FR-UIS-026). */
  @Column({ type: 'varchar', name: 'element_key', default: '' })
  elementKey!: string;

  @Column({ type: 'varchar', name: 'page_name', default: '' })
  pageName!: string;

  /** Origin + path of the page the element belongs to (query/hash dropped). */
  @Column({ type: 'varchar', name: 'page_url_pattern', default: '' })
  pageUrlPattern!: string;

  /** Human-facing element name used to match a test step's intent. */
  @Column({ type: 'varchar', name: 'element_name', default: '' })
  elementName!: string;

  @Column({ type: 'varchar', default: '' })
  role!: string;

  /**
   * Frame the element lives in, as the joined iframe-selector chain. Empty =
   * the main document. Denormalised out of `locatorData.frame.path` so a step
   * can be resolved against the right frame with an indexed lookup instead of
   * a JSON scan (FR-UIS-025 §4).
   */
  @Column({ type: 'varchar', name: 'frame_key', default: '' })
  frameKey!: string;

  /**
   * Named state of the page the element was captured in (e.g. `logged-in`,
   * `dialog-open`). Empty means the page's default state.
   */
  @Column({ type: 'varchar', name: 'page_state', default: '' })
  pageState!: string;

  @Column({ type: 'varchar', default: 'role' })
  strategy!: LocatorStrategy;

  @Column({ type: 'simple-json', name: 'locator_data' })
  locatorData!: Record<string, unknown>;

  @Column({ type: 'text', default: '' })
  expression!: string;

  /** The same locator in the sync-Python form this project's tests use. */
  @Column({ type: 'text', name: 'python_expression', default: '' })
  pythonExpression!: string;

  @Column({ type: 'float', name: 'confidence_score', default: 0 })
  confidenceScore!: number;

  @Column({ type: 'int', name: 'match_count', default: 0 })
  matchCount!: number;

  @Column({ type: 'varchar', name: 'validation_status', default: 'needs_review' })
  validationStatus!: LocatorStatus;

  @Column({ type: 'boolean', default: false })
  approved!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'int', default: 1 })
  version!: number;

  /** Row this one supersedes, for locator history and healing review. */
  @Column({ type: 'varchar', name: 'supersedes_id', nullable: true })
  supersedesId!: string | null;

  @Column({ type: 'varchar', default: 'deterministic-scanner' })
  source!: LocatorSource;

  /** Scoring reasons and warnings shown next to the locator in the UI. */
  @Column({ type: 'simple-json', nullable: true })
  rationale!: Record<string, unknown> | null;

  /** Element metadata kept for future self-healing comparison (FR-UIS-026). */
  @Column({ type: 'simple-json', name: 'element_snapshot', nullable: true })
  elementSnapshot!: Record<string, unknown> | null;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', name: 'approved_by', nullable: true })
  approvedBy!: string | null;

  @Column({ type: DATETIME_TYPE, name: 'last_validated_at', nullable: true })
  lastValidatedAt!: Date | null;

  // --- usage and execution metrics (FR-UIS-025 §15) ----------------------
  //
  // Generation counters answer "which tests depend on this locator?"; the
  // execution counters answer "is this locator still good?". They are kept
  // apart on purpose: a test can fail for a dozen reasons that say nothing
  // about the locator, and only a genuine resolution failure is recorded as a
  // locator failure here.

  /** Times this locator has been written into generated automation. */
  @Column({ type: 'int', name: 'usage_count', default: 0 })
  usageCount!: number;

  @Column({ type: DATETIME_TYPE, name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;

  /** Most recent generated artefact that uses this locator. */
  @Column({ type: 'varchar', name: 'last_used_automation_id', nullable: true })
  lastUsedAutomationId!: string | null;

  @Column({ type: 'varchar', name: 'last_used_test_case_id', nullable: true })
  lastUsedTestCaseId!: string | null;

  @Column({ type: 'varchar', name: 'last_used_test_step_id', nullable: true })
  lastUsedTestStepId!: string | null;

  @Column({ type: 'int', name: 'execution_success_count', default: 0 })
  executionSuccessCount!: number;

  @Column({ type: 'int', name: 'execution_failure_count', default: 0 })
  executionFailureCount!: number;

  @Column({ type: DATETIME_TYPE, name: 'last_executed_at', nullable: true })
  lastExecutedAt!: Date | null;

  @Column({ type: 'text', name: 'last_failure_reason', default: '' })
  lastFailureReason!: string;

  /**
   * True only when the last failure was the locator itself failing to resolve
   * the intended element — never for an application assertion, a timeout, a
   * backend error or bad test data (§15).
   */
  @Column({ type: 'boolean', name: 'locator_failure', default: false })
  locatorFailure!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
