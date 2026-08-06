import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Approval, GeneratedArtifact, TestCase, TestPlan } from '../../entities';
import { ApprovalsService } from './approvals.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Approval, TestPlan, TestCase, GeneratedArtifact]),
  ],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
