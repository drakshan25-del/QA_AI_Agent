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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedArtifact,
      TestCase,
      GenerationRun,
      Project,
    ]),
  ],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
