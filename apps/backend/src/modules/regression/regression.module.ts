import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExecutionRun,
  RegressionComparison,
  TestResult,
} from '../../entities';
import { RegressionService } from './regression.service';
import { RegressionController } from './regression.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegressionComparison, ExecutionRun, TestResult]),
  ],
  controllers: [RegressionController],
  providers: [RegressionService],
  exports: [RegressionService],
})
export class RegressionModule {}
