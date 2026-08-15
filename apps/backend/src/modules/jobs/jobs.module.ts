import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job, JobLogEntry } from '../../entities';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Job, JobLogEntry])],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
