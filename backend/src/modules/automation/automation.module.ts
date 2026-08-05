import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GeneratedArtifact,
  GenerationRun,
  Project,
  TestCase,
} from '../../entities';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { LocatorResolutionController } from './locator-resolution.controller';
import { LocatorResolutionService } from './locator-resolution.service';
import { ElementMatcherService } from './element-matcher.service';
import { UiScannerModule } from '../ui-scanner/ui-scanner.module';

/**
 * Automation generation (FR-AUT-*) and the locator resolution that feeds it
 * (FR-UIS-025).
 *
 * Resolution lives here rather than in the UI Scanner because it is a
 * *generation* concern: it reads the scanner's library through
 * `LocatorStorageService` and never owns a locator row of its own.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedArtifact,
      TestCase,
      GenerationRun,
      Project,
    ]),
    // Generation reads the project's approved locator library instead of
    // inventing selectors (FR-UIS-025).
    UiScannerModule,
  ],
  controllers: [AutomationController, LocatorResolutionController],
  providers: [AutomationService, LocatorResolutionService, ElementMatcherService],
  exports: [AutomationService, LocatorResolutionService, ElementMatcherService],
})
export class AutomationModule {}
