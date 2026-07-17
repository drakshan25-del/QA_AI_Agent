import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Concurrency-safe per-project counter (FR-V3-TC-003). `nextValue` is
 * advanced with a single atomic UPDATE so parallel generation or import jobs
 * can never mint duplicate TC-{int} identifiers.
 */
@Entity('project_sequences')
@Unique(['projectId', 'name'])
export class ProjectSequence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'project_id' })
  projectId!: string;

  /** Sequence name, e.g. `test_case`. */
  @Column({ type: 'varchar' })
  name!: string;

  /** The next value that will be handed out. */
  @Column({ type: 'int', name: 'next_value', default: 1 })
  nextValue!: number;
}
