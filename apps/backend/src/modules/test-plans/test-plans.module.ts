import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestPlan,
  TestPlanRevision,
} from '../../entities';
import { RequirementsModule } from '../requirements/requirements.module';
import { TestPlansService } from './test-plans.service';
import { TestPlansController } from './test-plans.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestPlan,
      TestPlanRevision,
      Requirement,
      Analysis,
      GenerationRun,
      Project,
    ]),
    RequirementsModule,
  ],
  controllers: [TestPlansController],
  providers: [TestPlansService],
  exports: [TestPlansService],
})
export class TestPlansModule {}
