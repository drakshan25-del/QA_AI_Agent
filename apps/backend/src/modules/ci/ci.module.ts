import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionRun, GeneratedArtifact, Project } from '../../entities';
import { CiService } from './ci.service';
import { CiController } from './ci.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, GeneratedArtifact, ExecutionRun]),
  ],
  controllers: [CiController],
  providers: [CiService],
  exports: [CiService],
})
export class CiModule {}
