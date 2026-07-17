import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectMember } from '../../entities';
import { AuthUser } from '../decorators';
import { ForbiddenAppException, NotFoundAppException } from '../errors';
import { Role } from '../enums';

/** Project membership checks (V2_CONTRACT §1 — project-scoped routes). */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly members: Repository<ProjectMember>,
  ) {}

  async getProjectOr404(projectId: string): Promise<Project> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);
    return project;
  }

  async isMember(projectId: string, userId: string): Promise<boolean> {
    const count = await this.members.count({ where: { projectId, userId } });
    return count > 0;
  }

  async ensureMember(projectId: string, user: AuthUser): Promise<void> {
    if (user.role === 'admin') return;
    const ok = await this.isMember(projectId, user.id);
    if (!ok) {
      throw new ForbiddenAppException(
        `User is not a member of project ${projectId}`,
      );
    }
  }

  async addMember(
    projectId: string,
    userId: string,
    projectRole: Role,
  ): Promise<ProjectMember> {
    const existing = await this.members.findOne({
      where: { projectId, userId },
    });
    if (existing) return existing;
    const member = this.members.create({ projectId, userId, projectRole });
    return this.members.save(member);
  }
}
