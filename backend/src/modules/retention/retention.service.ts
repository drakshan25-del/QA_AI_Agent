import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ExecutionEvent, JobLogEntry, UiScanLogEntry } from '../../entities';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';

/**
 * Configurable retention sweeps (FR-V3-ENT-011): job logs, execution events
 * and evidence directories older than the configured policy are deleted on a
 * periodic schedule, and every sweep is audit-logged. A value of 0 days keeps
 * records forever (the academic default).
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(JobLogEntry)
    private readonly jobLogs: Repository<JobLogEntry>,
    @InjectRepository(ExecutionEvent)
    private readonly executionEvents: Repository<ExecutionEvent>,
    @InjectRepository(UiScanLogEntry)
    private readonly uiScanLogs: Repository<UiScanLogEntry>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get policy(): AppConfig['retention'] {
    return (
      this.config.get<AppConfig['retention']>('retention') ?? {
        jobLogDays: 0,
        executionEventDays: 0,
        evidenceDays: 0,
        sweepIntervalMinutes: 720,
      }
    );
  }

  onModuleInit(): void {
    const { jobLogDays, executionEventDays, evidenceDays, sweepIntervalMinutes } =
      this.policy;
    if (!jobLogDays && !executionEventDays && !evidenceDays) {
      this.logger.log('Retention policy: keep everything (all windows = 0).');
      return;
    }
    const intervalMs = Math.max(sweepIntervalMinutes, 5) * 60_000;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<Record<string, number>> {
    const { jobLogDays, executionEventDays, evidenceDays } = this.policy;
    const removed: Record<string, number> = {
      jobLogs: 0,
      uiScanLogs: 0,
      executionEvents: 0,
      evidenceDirs: 0,
    };
    try {
      if (jobLogDays > 0) {
        const res = await this.jobLogs.delete({
          createdAt: LessThan(daysAgo(jobLogDays)),
        });
        removed.jobLogs = res.affected ?? 0;
        // UI-scan console lines are the same kind of record as job logs, so
        // they follow the same window rather than growing forever.
        const scanRes = await this.uiScanLogs.delete({
          createdAt: LessThan(daysAgo(jobLogDays)),
        });
        removed.uiScanLogs = scanRes.affected ?? 0;
      }
      if (executionEventDays > 0) {
        const res = await this.executionEvents.delete({
          createdAt: LessThan(daysAgo(executionEventDays)),
        });
        removed.executionEvents = res.affected ?? 0;
      }
      if (evidenceDays > 0) {
        removed.evidenceDirs = await this.sweepEvidence(daysAgo(evidenceDays));
      }
      if (
        removed.jobLogs ||
        removed.uiScanLogs ||
        removed.executionEvents ||
        removed.evidenceDirs
      ) {
        await this.audit.record({
          actor: 'system',
          actorId: null,
          action: 'retention.sweep',
          resourceType: 'system',
          resourceId: 'retention',
          projectId: null,
          metadata: removed,
        });
        this.logger.log(
          `Retention sweep removed ${JSON.stringify(removed)} expired records`,
        );
      }
    } catch (err) {
      this.logger.warn(`retention sweep failed: ${(err as Error).message}`);
    }
    return removed;
  }

  /** Delete run evidence directories older than the cutoff. */
  private async sweepEvidence(cutoff: Date): Promise<number> {
    const artifactsDir = join(process.cwd(), '..', 'artifacts');
    let removed = 0;
    try {
      const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = join(artifactsDir, entry.name);
        const stat = await fs.stat(full);
        if (stat.mtime < cutoff) {
          await fs.rm(full, { recursive: true, force: true });
          removed += 1;
        }
      }
    } catch {
      // artifacts dir may not exist on this host — nothing to sweep.
    }
    return removed;
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
