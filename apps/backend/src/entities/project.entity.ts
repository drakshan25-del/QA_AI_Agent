import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus, Runner } from '../common/enums';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', name: 'base_url', default: '' })
  baseUrl!: string;

  /** Comma-separated allow-list for browser navigation (SEC-003). */
  @Column({ type: 'varchar', name: 'allowed_domains', default: 'localhost,127.0.0.1' })
  allowedDomains!: string;

  @Column({ type: 'varchar', default: '' })
  repository!: string;

  @Column({ type: 'varchar', default: 'test' })
  environment!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: ProjectStatus;

  @Column({ type: 'varchar', name: 'llm_model', default: '' })
  llmModel!: string;

  @Column({ type: 'float', name: 'llm_temperature', default: 0.1 })
  llmTemperature!: number;

  @Column({ type: 'varchar', default: 'pytest' })
  runner!: Runner;

  /**
   * Optional zero-padding width for displayed test-case IDs (FR-V3-TC-004):
   * 0 = TC-1; 4 = TC-0001. The canonical numeric value is always stored.
   */
  @Column({ type: 'int', name: 'tc_zero_pad', default: 0 })
  tcZeroPad!: number;

  @Column({ type: 'varchar', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
