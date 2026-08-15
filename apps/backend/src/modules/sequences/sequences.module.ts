import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectSequence } from '../../entities';
import { SequencesService } from './sequences.service';

/** Concurrency-safe ID sequences (FR-V3-TC-003). Global for feature services. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ProjectSequence])],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}
