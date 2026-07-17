import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project, ProjectMember, User } from '../../entities';
import { MembershipService } from './membership.service';
import { ProjectMemberGuard } from './project-member.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, User])],
  providers: [MembershipService, ProjectMemberGuard],
  exports: [MembershipService, ProjectMemberGuard, TypeOrmModule],
})
export class AccessModule {}
