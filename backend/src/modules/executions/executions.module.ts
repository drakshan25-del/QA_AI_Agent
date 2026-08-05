import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExecutionEvent,
  ExecutionLogEntry,
  ExecutionRun,
  GeneratedArtifact,
  Project,
  TestResult,
} from '../../entities';
import { ExecutionsService } from './executions.service';
import { ExecutionLoggerService } from './execution-logger.service';
import {
  ExecutionsController,
  ProjectExecutionsController,
} from './executions.controller';
import { UiScannerModule } from '../ui-scanner/ui-scanner.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExecutionRun,
      ExecutionEvent,
      ExecutionLogEntry,
      TestResult,
      GeneratedArtifact,
      Project,
    ]),
    // A finished run feeds the locator execution metrics (FR-UIS-025 §15).
    UiScannerModule,
  ],
  controllers: [ExecutionsController, ProjectExecutionsController],
  providers: [ExecutionsService, ExecutionLoggerService],
  // Exported so other modules can stream run-scoped logs (reusable logger).
  exports: [ExecutionsService, ExecutionLoggerService],
})
export class ExecutionsModule {}
