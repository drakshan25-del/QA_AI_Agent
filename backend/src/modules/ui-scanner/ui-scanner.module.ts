import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LocatorRecord,
  Project,
  ScannedElement,
  StepLocatorReference,
  UiScan,
  UiScanLogEntry,
} from '../../entities';
import { UiScannerService } from './ui-scanner.service';
import { UiScanLoggerService } from './ui-scan-logger.service';
import { UiScanArtifactsService } from './ui-scan-artifacts.service';
import { LocatorStorageService } from './locator-storage.service';
import { LocatorUsageService } from './locator-usage.service';
import {
  ProjectLocatorsController,
  UiScannerController,
} from './ui-scanner.controller';

/**
 * UI Scanner Agent (FR-UIS-*).
 *
 * `LocatorStorageService` is exported because automation generation reads the
 * approved locator library from it: the generator looks a locator up instead
 * of inventing a selector (FR-UIS-025). `LocatorUsageService` is exported for
 * the same reason from the other end — generation writes the step→locator
 * traceability rows, and execution folds its outcomes back into the locator's
 * metrics (§9, §15). Both keep the locator repository in one module: nothing
 * outside this one owns locator rows.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UiScan,
      ScannedElement,
      LocatorRecord,
      UiScanLogEntry,
      StepLocatorReference,
      Project,
    ]),
  ],
  controllers: [UiScannerController, ProjectLocatorsController],
  providers: [
    UiScannerService,
    UiScanLoggerService,
    UiScanArtifactsService,
    LocatorStorageService,
    LocatorUsageService,
  ],
  exports: [
    UiScannerService,
    UiScanArtifactsService,
    LocatorStorageService,
    LocatorUsageService,
  ],
})
export class UiScannerModule {}
