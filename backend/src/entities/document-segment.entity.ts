import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('document_segments')
export class DocumentSegment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'document_id' })
  documentId!: string;

  @Column({ type: 'int', default: 0 })
  sequence!: number;

  @Column({ type: 'varchar', name: 'page_or_sheet', default: '' })
  pageOrSheet!: string;

  @Column({ type: 'varchar', name: 'row_or_section', default: '' })
  rowOrSection!: string;

  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  /** included|excluded — segment inclusion toggle (FR-IN-009). */
  @Column({ type: 'varchar', name: 'inclusion_status', default: 'included' })
  inclusionStatus!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
