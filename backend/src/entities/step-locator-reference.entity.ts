import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DATETIME_TYPE } from '../common/column-types';
import { LocatorResolutionSource, LocatorStatus } from '../common/enums';

/**
 * One generated Playwright interaction, tied to the scanned locator it used
 * (FR-UIS-025 §9).
 *
 * This is the row that makes the chain traceable in both directions:
 *
 *   generated line → test step → scanned element → locator record → version → scan
 *
 * It is written *after* the model returns code, from the resolution result the
 * model was given, so it records what the generator was bound to rather than
 * what it claims to have used. `generatedExpression` is stored purely as
 * evidence — like every other expression string in this system it is displayed
 * and compared, never executed (SEC-005).
 */
@Entity('generated_step_locator_refs')
@Index(['projectId', 'generatedAutomationId'])
@Index(['projectId', 'testCaseId'])
export class StepLocatorReference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'test_case_id', default: '' })
  testCaseId!: string;

  /** Stable id of the step within its test case, e.g. `<caseId>:step-3`. */
  @Column({ type: 'varchar', name: 'test_step_id', default: '' })
  testStepId!: string;

  @Column({ type: 'int', name: 'step_sequence', default: 0 })
  stepSequence!: number;

  @Column({ type: 'text', name: 'test_step_text', default: '' })
  testStepText!: string;

  /** The generation run this reference belongs to. */
  @Column({ type: 'varchar', name: 'generated_automation_id', default: '' })
  generatedAutomationId!: string;

  /** The generated artefact (file) the step's code landed in, when known. */
  @Column({ type: 'varchar', name: 'generated_file_id', nullable: true })
  generatedFileId!: string | null;

  @Column({ type: 'varchar', name: 'scanned_element_id', default: '' })
  scannedElementId!: string;

  @Column({ type: 'varchar', name: 'element_name', default: '' })
  elementName!: string;

  @Column({ type: 'varchar', name: 'page_name', default: '' })
  pageName!: string;

  @Column({ type: 'varchar', name: 'page_url_pattern', default: '' })
  pageUrlPattern!: string;

  @Index()
  @Column({ type: 'varchar', name: 'locator_id', default: '' })
  locatorId!: string;

  @Column({ type: 'int', name: 'locator_version', default: 1 })
  locatorVersion!: number;

  @Column({ type: 'varchar', name: 'scan_id', nullable: true })
  scanId!: string | null;

  @Column({ type: 'varchar', default: 'role' })
  strategy!: string;

  @Column({ type: 'float', name: 'element_match_confidence', default: 0 })
  elementMatchConfidence!: number;

  @Column({ type: 'float', name: 'locator_confidence', default: 0 })
  locatorConfidence!: number;

  @Column({ type: 'varchar', name: 'validation_status', default: 'needs_review' })
  validationStatus!: LocatorStatus;

  @Column({ type: 'varchar', default: 'DETERMINISTIC_SCANNER' })
  source!: LocatorResolutionSource;

  /** Displayable Playwright code that was handed to the generator. */
  @Column({ type: 'text', name: 'generated_expression', default: '' })
  generatedExpression!: string;

  /** Why this element was chosen — the matcher's signals, for review. */
  @Column({ type: 'simple-json', name: 'match_rationale', nullable: true })
  matchRationale!: Record<string, unknown> | null;

  @Column({ type: DATETIME_TYPE, name: 'validated_at', nullable: true })
  validatedAt!: Date | null;

  @Column({ type: DATETIME_TYPE, name: 'resolved_at' })
  resolvedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
