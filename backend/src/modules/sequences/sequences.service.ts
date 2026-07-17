import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectSequence } from '../../entities';
import { ConflictAppException } from '../../common/errors';

/**
 * Concurrency-safe per-project sequence allocator (FR-V3-TC-003). Reservation
 * uses an optimistic compare-and-swap UPDATE (`WHERE next_value = :expected`)
 * so parallel generation or import jobs can never receive overlapping ranges,
 * on both the PostgreSQL and SQLite drivers.
 */
@Injectable()
export class SequencesService {
  private static readonly MAX_ATTEMPTS = 25;

  constructor(
    @InjectRepository(ProjectSequence)
    private readonly repo: Repository<ProjectSequence>,
  ) {}

  /**
   * Atomically reserve `count` consecutive values and return the first one.
   * E.g. `next('p1', 'test_case', 3)` → 1 means TC-1, TC-2 and TC-3 are yours.
   */
  async next(projectId: string, name: string, count = 1): Promise<number> {
    if (count < 1) throw new Error('count must be >= 1');

    for (let attempt = 0; attempt < SequencesService.MAX_ATTEMPTS; attempt++) {
      const row = await this.repo.findOne({ where: { projectId, name } });
      if (!row) {
        try {
          await this.repo.insert({ projectId, name, nextValue: 1 + count });
          return 1;
        } catch {
          continue; // another writer created it first — retry the CAS path
        }
      }
      const res = await this.repo.update(
        { id: row.id, nextValue: row.nextValue },
        { nextValue: row.nextValue + count },
      );
      if ((res.affected ?? 0) === 1) return row.nextValue;
      // Lost the race — retry with a fresh read.
    }
    throw new ConflictAppException(
      `Could not reserve sequence ${name} for project ${projectId} after ` +
        `${SequencesService.MAX_ATTEMPTS} attempts.`,
      'sequence_contention',
    );
  }

  /** Ensure the sequence will hand out values strictly above `minimum`. */
  async raiseTo(projectId: string, name: string, minimum: number): Promise<void> {
    for (let attempt = 0; attempt < SequencesService.MAX_ATTEMPTS; attempt++) {
      const row = await this.repo.findOne({ where: { projectId, name } });
      if (!row) {
        try {
          await this.repo.insert({ projectId, name, nextValue: minimum + 1 });
          return;
        } catch {
          continue;
        }
      }
      if (row.nextValue > minimum) return;
      const res = await this.repo.update(
        { id: row.id, nextValue: row.nextValue },
        { nextValue: minimum + 1 },
      );
      if ((res.affected ?? 0) === 1) return;
    }
  }
}
