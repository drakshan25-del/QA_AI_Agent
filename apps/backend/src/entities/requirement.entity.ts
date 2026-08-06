import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('requirements')
export class Requirement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', default: 'manual' })
  source!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', default: '' })
  title!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'simple-json', name: 'acceptance_criteria', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'varchar', default: 'draft' })
  status!: string;

  @Column({ type: 'varchar', name: 'source_document_id', nullable: true })
  sourceDocumentId!: string | null;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
