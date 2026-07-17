import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestPlan,
} from '../../entities';
import { TestPlansService } from './test-plans.service';
import { TestPlansController } from './test-plans.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestPlan,
      Requirement,
      Analysis,
      GenerationRun,
      Project,
    ]),
  ],
  controllers: [TestPlansController],
  providers: [TestPlansService],
  exports: [TestPlansService],
})
export class TestPlansModule {}
