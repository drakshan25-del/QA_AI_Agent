import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionEvent, JobLogEntry, UiScanLogEntry } from '../../entities';
import { RetentionService } from './retention.service';

/** Configurable retention policies (FR-V3-ENT-011). */
@Module({
  imports: [TypeOrmModule.forFeature([JobLogEntry, ExecutionEvent, UiScanLogEntry])],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
