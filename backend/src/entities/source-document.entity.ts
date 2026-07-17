import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentCategory } from '../common/enums';

@Entity('source_documents')
export class SourceDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar' })
  filename!: string;

  @Column({ type: 'varchar', default: 'user_story' })
  category!: DocumentCategory;

  @Column({ type: 'varchar', default: '' })
  kind!: string;

  @Column({ type: 'varchar', name: 'mime_type', default: '' })
  mimeType!: string;

  @Column({ type: 'int', name: 'size_bytes', default: 0 })
  sizeBytes!: number;

  @Column({ type: 'varchar', name: 'parse_status', default: 'pending' })
  parseStatus!: string;

  @Column({ type: 'text', default: '' })
  message!: string;

  @Column({ type: 'varchar', name: 'storage_path', default: '' })
  storagePath!: string;

  @Column({ type: 'varchar', name: 'content_hash', default: '' })
  contentHash!: string;

  @Column({ type: 'varchar', name: 'uploaded_by', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
