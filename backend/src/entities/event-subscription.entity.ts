import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Tracks a WS client's resume cursor per project/run (FR-BE-004). */
@Entity('event_subscriptions')
export class EventSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  @Column({ type: 'varchar', name: 'run_id', nullable: true })
  runId!: string | null;

  @Column({ type: 'varchar', name: 'client_id', default: '' })
  clientId!: string;

  @Column({ type: 'varchar', name: 'user_id', nullable: true })
  userId!: string | null;

  @Column({ type: 'int', name: 'last_seq', default: 0 })
  lastSeq!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
