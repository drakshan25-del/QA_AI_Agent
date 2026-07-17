import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityTarget,
  FindOptionsWhere,
  In,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import {
  Analysis,
  Approval,
  ExecutionRun,
  GeneratedArtifact,
  Project,
  ProjectMember,
  Requirement,
  SourceDocument,
  TestCase,
  TestPlan,
  TestResult,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly members: Repository<ProjectMember>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreateProjectDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Project> {
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? '',
      baseUrl: dto.baseUrl ?? '',
      allowedDomains: dto.allowedDomains ?? 'localhost,127.0.0.1',
      repository: dto.repository ?? '',
      environment: dto.environment ?? 'test',
      status: 'active',
      llmModel: dto.llmModel ?? '',
      llmTemperature: dto.llmTemperature ?? 0.1,
      runner: dto.runner ?? 'pytest',
      createdBy: user.id,
    });
    const saved = await this.projects.save(project);
    await this.membership.addMember(saved.id, user.id, user.role);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'project.create',
      resourceType: 'project',
      resourceId: saved.id,
      projectId: saved.id,
      correlationId,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async findAllForUser(user: AuthUser): Promise<Project[]> {
    if (user.role === 'admin') {
      return this.projects.find({ order: { createdAt: 'DESC' } });
    }
    const memberships = await this.members.find({
      where: { userId: user.id },
    });
    const ids = memberships.map((m) => m.projectId);
    if (!ids.length) return [];
    return this.projects.find({
      where: { id: In(ids) },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: AuthUser): Promise<Project> {
    await this.membership.ensureMember(id, user);
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundAppException(`Project ${id} not found`);
    return project;
  }

  /** GET /projects/:id including a workflow summary (FR-PROJ-006). */
  async findOneWithSummary(
    id: string,
    user: AuthUser,
  ): Promise<Project & { workflowSummary: Record<string, unknown> }> {
    const project = await this.findOne(id, user);
    const workflowSummary = await this.workflowSummary(id);
    return Object.assign(project, { workflowSummary });
  }

  private async workflowSummary(
    projectId: string,
  ): Promise<Record<string, unknown>> {
    const count = (
      entity: EntityTarget<ObjectLiteral>,
      where: Record<string, unknown> = {},
    ) =>
      this.dataSource.getRepository(entity).count({
        where: { projectId, ...where } as FindOptionsWhere<ObjectLiteral>,
      });

    const [
      documents,
      requirements,
      analyses,
      testPlans,
      approvedPlans,
      testCases,
      approvedCases,
      artifacts,
      executions,
      pendingApprovals,
    ] = await Promise.all([
      count(SourceDocument),
      count(Requirement),
      count(Analysis),
      count(TestPlan),
      count(TestPlan, { approvalStatus: 'approved' }),
      count(TestCase),
      count(TestCase, { approvalStatus: 'approved' }),
      count(GeneratedArtifact),
      count(ExecutionRun),
      count(Approval, { decision: 'regenerate' }),
    ]);

    return {
      documents,
      requirements,
      analyses,
      testPlans,
      approvedPlans,
      testCases,
      approvedCases,
      artifacts,
      executions,
      pendingApprovals,
    };
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Project> {
    const project = await this.findOne(id, user);
    Object.assign(project, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
      ...(dto.allowedDomains !== undefined
        ? { allowedDomains: dto.allowedDomains }
        : {}),
      ...(dto.repository !== undefined ? { repository: dto.repository } : {}),
      ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.llmModel !== undefined ? { llmModel: dto.llmModel } : {}),
      ...(dto.llmTemperature !== undefined
        ? { llmTemperature: dto.llmTemperature }
        : {}),
      ...(dto.runner !== undefined ? { runner: dto.runner } : {}),
    });
    const saved = await this.projects.save(project);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'project.update',
      resourceType: 'project',
      resourceId: id,
      projectId: id,
      correlationId,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  /** Machine-readable export, no secrets (§10.2, §15.2). */
  async exportProject(
    id: string,
    user: AuthUser,
  ): Promise<Record<string, unknown>> {
    const project = await this.findOne(id, user);
    const load = (entity: EntityTarget<ObjectLiteral>) =>
      this.dataSource.getRepository(entity).find({
        where: { projectId: id } as FindOptionsWhere<ObjectLiteral>,
      });
    const [requirements, analyses, testPlans, testCases, artifacts, executions] =
      await Promise.all([
        load(Requirement),
        load(Analysis),
        load(TestPlan),
        load(TestCase),
        load(GeneratedArtifact),
        load(ExecutionRun),
      ]);
    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        baseUrl: project.baseUrl,
        allowedDomains: project.allowedDomains,
        repository: project.repository,
        environment: project.environment,
        status: project.status,
        runner: project.runner,
        createdAt: project.createdAt,
      },
      requirements,
      analyses,
      testPlans,
      testCases,
      artifacts: (artifacts as GeneratedArtifact[]).map((a) => ({
        ...a,
        content: undefined,
      })),
      executions,
      exportedAt: new Date().toISOString(),
    };
  }

  /** Aggregate metrics (§15.2). */
  async metrics(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    await this.findOne(id, user);
    const summary = await this.workflowSummary(id);
    const results = await this.dataSource
      .getRepository(TestResult)
      .createQueryBuilder('r')
      .innerJoin(ExecutionRun, 'e', 'e.id = r.execution_run_id')
      .where('e.project_id = :id', { id })
      .getMany();
    const passed = results.filter((r) => r.outcome === 'passed').length;
    const failed = results.filter((r) => r.outcome === 'failed').length;
    const total = results.length;
    return {
      ...summary,
      results: {
        total,
        passed,
        failed,
        passRate: total ? Math.round((passed / total) * 100) / 100 : 0,
      },
    };
  }

  async addMember(
    projectId: string,
    userId: string,
    projectRole: AuthUser['role'],
    actor: AuthUser,
    correlationId?: string,
  ): Promise<ProjectMember> {
    await this.findOne(projectId, actor);
    const member = await this.membership.addMember(
      projectId,
      userId,
      projectRole,
    );
    await this.audit.record({
      actor: actor.email,
      actorId: actor.id,
      action: 'project.member.add',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      correlationId,
      metadata: { userId, projectRole },
    });
    return member;
  }
}
