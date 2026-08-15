import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DocumentSegment,
  GeneratedArtifact,
  GenerationRun,
  Project,
  Requirement,
  SourceDocument,
  TestCase,
} from '../../entities';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedArtifact,
      TestCase,
      GenerationRun,
      Project,
      SourceDocument,
      DocumentSegment,
      Requirement,
    ]),
  ],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
