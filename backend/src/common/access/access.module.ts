import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project, ProjectMember, User } from '../../entities';
import { MembershipService } from './membership.service';
import { ProjectMemberGuard } from './project-member.guard';
import { PermissionsGuard } from './permissions';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, User])],
  providers: [
    MembershipService,
    ProjectMemberGuard,
    PermissionsGuard,
    // RBAC guard applied globally; @RequirePermission opts routes in
    // (FR-V3-ENT-001 — every protected action is authorised server-side).
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [MembershipService, ProjectMemberGuard, PermissionsGuard, TypeOrmModule],
})
export class AccessModule {}
