import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Analysis,
  GenerationRun,
  Project,
  Requirement,
  TestCase,
} from '../../entities';
import { TestCasesService } from './test-cases.service';
import { TestCasesController } from './test-cases.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestCase,
      Requirement,
      Analysis,
      GenerationRun,
      Project,
    ]),
  ],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
