import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationType } from '../common/enums';

/**
 * In-app notification (FR-V3-ENT-007): completion, failure, approval request
 * and CI/CD results. Rows are per-recipient; a matching `notification.new`
 * envelope is broadcast on the project event stream when one is created.
 */
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'user_id' })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id', nullable: true })
  projectId!: string | null;

  @Column({ type: 'varchar' })
  type!: NotificationType;

  @Column({ type: 'varchar', default: '' })
  title!: string;

  @Column({ type: 'text', default: '' })
  message!: string;

  @Column({ type: 'varchar', name: 'resource_type', default: '' })
  resourceType!: string;

  @Column({ type: 'varchar', name: 'resource_id', default: '' })
  resourceId!: string;

  @Index()
  @Column({ type: 'boolean', default: false })
  read!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
