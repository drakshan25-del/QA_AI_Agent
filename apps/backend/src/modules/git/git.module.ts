import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedArtifact, Project } from '../../entities';
import { GitService } from './git.service';
import { GitController } from './git.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Project, GeneratedArtifact])],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
