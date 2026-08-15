import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus, Runner } from '../common/enums';
import { LlmType } from '../common/llm/providers';

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

  /**
   * Base URL of the API under test when it differs from the UI `baseUrl`
   * (different port, or an `/api/v1` style prefix). Empty = same as baseUrl.
   * Generated API tests resolve their relative paths against this value.
   */
  @Column({ type: 'varchar', name: 'api_base_url', default: '' })
  apiBaseUrl!: string;

  /** Comma-separated allow-list for browser navigation (SEC-003). */
  @Column({ type: 'varchar', name: 'allowed_domains', default: 'localhost,127.0.0.1' })
  allowedDomains!: string;

  @Column({ type: 'varchar', default: '' })
  repository!: string;

  @Column({ type: 'varchar', default: 'test' })
  environment!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: ProjectStatus;

  /** LOCAL (Ollama, the default) or CLOUD. Existing rows default to LOCAL. */
  @Column({ type: 'varchar', name: 'llm_type', default: 'LOCAL' })
  llmType!: LlmType;

  /** Local (Ollama) model when llmType = LOCAL. */
  @Column({ type: 'varchar', name: 'llm_model', default: '' })
  llmModel!: string;

  @Column({ type: 'float', name: 'llm_temperature', default: 0.1 })
  llmTemperature!: number;

  @Column({ type: 'varchar', name: 'cloud_provider', default: '' })
  cloudProvider!: string;

  @Column({ type: 'varchar', name: 'cloud_model', default: '' })
  cloudModel!: string;

  /** Optional endpoint override for OpenAI-compatible gateways. */
  @Column({ type: 'varchar', name: 'cloud_base_url', default: '' })
  cloudBaseUrl!: string;

  /**
   * AES-256-GCM sealed cloud API key (SEC-002). `select: false` keeps it out
   * of every ordinary find/serialization; only the engine-dispatch path loads
   * it explicitly via addSelect.
   */
  @Column({ type: 'varchar', name: 'cloud_api_key_enc', default: '', select: false })
  cloudApiKeyEnc?: string;

  /** Presence flag exposed to clients instead of the key itself. */
  @Column({ type: 'boolean', name: 'has_cloud_api_key', default: false })
  hasCloudApiKey!: boolean;

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
