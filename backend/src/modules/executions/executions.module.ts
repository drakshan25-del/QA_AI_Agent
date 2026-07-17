import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExecutionEvent,
  ExecutionRun,
  GeneratedArtifact,
  Project,
  TestResult,
} from '../../entities';
import { ExecutionsService } from './executions.service';
import {
  ExecutionsController,
  ProjectExecutionsController,
} from './executions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExecutionRun,
      ExecutionEvent,
      TestResult,
      GeneratedArtifact,
      Project,
    ]),
  ],
  controllers: [ExecutionsController, ProjectExecutionsController],
  providers: [ExecutionsService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
