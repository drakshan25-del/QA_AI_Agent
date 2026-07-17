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
import { ExecutionsController } from './executions.controller';

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
  controllers: [ExecutionsController],
  providers: [ExecutionsService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
