import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../common/enums';

@Entity('project_members')
@Index(['projectId', 'userId'], { unique: true })
export class ProjectMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'user_id' })
  userId!: string;

  /** Role of the user within this project (may differ from global role). */
  @Column({ type: 'varchar', name: 'project_role', default: 'qa_engineer' })
  projectRole!: Role;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
