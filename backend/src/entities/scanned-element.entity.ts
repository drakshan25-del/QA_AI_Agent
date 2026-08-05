import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LocatorStatus } from '../common/enums';

/**
 * One UI element discovered by a scan, with every locator candidate that was
 * generated and validated for it (FR-UIS-007).
 *
 * `elementKey` is derived from the element's own semantics (frame, tag, role,
 * accessible name) rather than its DOM position, so the same control keeps the
 * same key across rescans — which is what makes locator versioning and future
 * self-healing comparable over time (FR-UIS-026).
 *
 * Values of credential-bearing fields are never stored: the engine drops them
 * at capture and only role, label, placeholder and type survive (§7).
 */
@Entity('scanned_elements')
@Index(['scanId', 'elementKey'])
export class ScannedElement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'scan_id' })
  scanId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Stable, semantics-derived identity of the element within the scan. */
  @Column({ type: 'varchar', name: 'element_key' })
  elementKey!: string;

  @Column({ type: 'varchar', name: 'tag_name', default: '' })
  tagName!: string;

  @Column({ type: 'varchar', default: '' })
  role!: string;

  @Column({ type: 'varchar', name: 'explicit_role', default: '' })
  explicitRole!: string;

  @Column({ type: 'varchar', name: 'accessible_name', default: '' })
  accessibleName!: string;

  @Column({ type: 'varchar', name: 'accessible_name_source', default: '' })
  accessibleNameSource!: string;

  @Column({ type: 'text', name: 'visible_text', default: '' })
  visibleText!: string;

  /** id, name, type, placeholder, test ids, aria-* … (redacted). */
  @Column({ type: 'simple-json', nullable: true })
  attributes!: Record<string, unknown> | null;

  /** visible, enabled, editable, required, checked, expanded … */
  @Column({ type: 'simple-json', nullable: true })
  states!: Record<string, boolean> | null;

  /** x, y, width, height, inViewport. */
  @Column({ type: 'simple-json', nullable: true })
  position!: Record<string, number> | null;

  /** Parent form/dialog/region, nearest heading, label, nearby text, scopes. */
  @Column({ type: 'simple-json', nullable: true })
  context!: Record<string, unknown> | null;

  /** Frame chain the element lives in; empty path = the main document. */
  @Column({ type: 'simple-json', nullable: true })
  frame!: Record<string, unknown> | null;

  /** Every generated candidate with its score, verdict and reasons. */
  @Column({ type: 'simple-json', nullable: true })
  candidates!: Record<string, unknown>[] | null;

  @Column({ type: 'varchar', name: 'recommended_locator_id', default: '' })
  recommendedLocatorId!: string;

  @Column({ type: 'varchar', default: 'needs_review' })
  status!: LocatorStatus;

  /** True when the element is a credential field (value never captured). */
  @Column({ type: 'boolean', default: false })
  sensitive!: boolean;

  @Column({ type: 'varchar', name: 'page_url', default: '' })
  pageUrl!: string;

  @Column({ type: 'varchar', name: 'page_title', default: '' })
  pageTitle!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
