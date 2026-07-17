import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent, Requirement } from '../../entities';
import { RequirementsService } from './requirements.service';
import { RequirementsController } from './requirements.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Requirement, AuditEvent])],
  controllers: [RequirementsController],
  providers: [RequirementsService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
