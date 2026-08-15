import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Analysis, GenerationRun, Project, Requirement } from '../../entities';
import { RequirementsModule } from '../requirements/requirements.module';
import { AnalysisService } from './analysis.service';
import { AnalysisController } from './analysis.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Analysis, Requirement, GenerationRun, Project]),
    RequirementsModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
