import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuditEvent,
  DocumentSegment,
  Requirement,
  SourceDocument,
} from '../../entities';
import { RequirementsService } from './requirements.service';
import { RequirementDerivationService } from './requirement-derivation.service';
import { RequirementsController } from './requirements.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Requirement,
      AuditEvent,
      SourceDocument,
      DocumentSegment,
    ]),
  ],
  controllers: [RequirementsController],
  providers: [RequirementsService, RequirementDerivationService],
  exports: [RequirementsService, RequirementDerivationService],
})
export class RequirementsModule {}
