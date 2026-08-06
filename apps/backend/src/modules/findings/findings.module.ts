import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionRun, Finding, TestResult } from '../../entities';
import { FindingsService } from './findings.service';
import { FindingsController } from './findings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Finding, TestResult, ExecutionRun])],
  controllers: [FindingsController],
  providers: [FindingsService],
  exports: [FindingsService],
})
export class FindingsModule {}
