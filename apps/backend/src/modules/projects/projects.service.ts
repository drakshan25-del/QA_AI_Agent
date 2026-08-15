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
  AuditEvent,
  ExecutionRun,
  Finding,
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
import { isAdminRole } from '../../common/access/permissions';
import {
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { SecretBoxService } from '../../common/crypto/secret-box.service';
import { cloudProviderById } from '../../common/llm/providers';
import { normalizeRepoSlug } from '../git/repo-slug.util';
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
    private readonly secretBox: SecretBoxService,
  ) {}

  /**
   * The sealed key column is select:false, but entities we just saved still
   * hold it in memory — strip it so it can never serialize to a client.
   */
  private sanitize(project: Project): Project {
    delete project.cloudApiKeyEnc;
    return project;
  }

  /**
   * The active LLM configuration must be complete before a project is created
   * or switched (the UI enforces the same rules field-by-field).
   */
  private assertLlmConfigComplete(project: Project): void {
    if (project.llmType !== 'CLOUD') return;
    const missing: string[] = [];
    if (!project.cloudProvider) missing.push('cloudProvider');
    if (!project.cloudModel) missing.push('cloudModel');
    if (!project.hasCloudApiKey) missing.push('cloudApiKey');
    const provider = cloudProviderById(project.cloudProvider);
    if (provider && !provider.defaultBaseUrl && !project.cloudBaseUrl) {
      missing.push('cloudBaseUrl');
    }
    if (missing.length) {
      throw new ValidationFailedException(
        `Cloud LLM configuration is incomplete: ${missing.join(', ')} required`,
        { missing },
      );
    }
  }

  /**
   * Repositories are stored as the canonical 'owner/repo' slug — git push and
   * CI dispatch both build GitHub URLs from it, so URL forms are normalized
   * here rather than at every read site.
   */
  private canonicalRepository(value: string): string {
    if (!value.trim()) return '';
    const slug = normalizeRepoSlug(value);
    if (!slug) {
      throw new ValidationFailedException(
        "Repository must be 'owner/repo' or a GitHub repository URL",
        { repository: value },
      );
    }
    return slug;
  }

  async create(
    dto: CreateProjectDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Project> {
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? '',
      baseUrl: dto.baseUrl ?? '',
      apiBaseUrl: dto.apiBaseUrl ?? '',
      allowedDomains: dto.allowedDomains ?? 'localhost,127.0.0.1',
      repository: this.canonicalRepository(dto.repository ?? ''),
      environment: dto.environment ?? 'test',
      status: 'active',
      llmType: dto.llmType ?? 'LOCAL',
      llmModel: dto.llmModel ?? '',
      llmTemperature: dto.llmTemperature ?? 0.1,
      cloudProvider: dto.cloudProvider ?? '',
      cloudModel: dto.cloudModel ?? '',
      cloudBaseUrl: dto.cloudBaseUrl ?? '',
      cloudApiKeyEnc: dto.cloudApiKey ? this.secretBox.seal(dto.cloudApiKey) : '',
      hasCloudApiKey: !!dto.cloudApiKey,
      runner: dto.runner ?? 'pytest',
      tcZeroPad: dto.tcZeroPad ?? 0,
      createdBy: user.id,
    });
    this.assertLlmConfigComplete(project);
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
      metadata: { name: saved.name, llmType: saved.llmType },
    });
    return this.sanitize(saved);
  }

  async findAllForUser(user: AuthUser): Promise<Project[]> {
    if (isAdminRole(user.role)) {
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
      this.pendingApprovalsCount(projectId),
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

  private async pendingApprovalsCount(projectId: string): Promise<number> {
    const count = (
      entity: EntityTarget<ObjectLiteral>,
      where: Record<string, unknown> = {},
    ) =>
      this.dataSource.getRepository(entity).count({
        where: { projectId, ...where } as FindOptionsWhere<ObjectLiteral>,
      });
    const [plans, cases, artifacts] = await Promise.all([
      count(TestPlan, { approvalStatus: 'pending' }),
      count(TestCase, { approvalStatus: 'pending' }),
      count(GeneratedArtifact, { approvalStatus: 'pending', status: 'active' }),
    ]);
    return plans + cases + artifacts;
  }

  /**
   * Project dashboard (FR-V3-ENT-003): workflow status, pending approvals,
   * recent runs, pass rate, defect count and recent activity — scoped by
   * membership and linking back to source records.
   */
  async dashboard(id: string, user: AuthUser): Promise<Record<string, unknown>> {
    await this.findOne(id, user);
    const summary = await this.workflowSummary(id);

    const runs = await this.dataSource.getRepository(ExecutionRun).find({
      where: { projectId: id },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const results = await this.dataSource
      .getRepository(TestResult)
      .createQueryBuilder('r')
      .innerJoin(ExecutionRun, 'e', 'CAST(e.id AS varchar) = r.execution_run_id')
      .where('e.project_id = :id', { id })
      .getMany();
    const passed = results.filter((r) => r.outcome === 'passed').length;
    const failed = results.filter((r) => r.outcome === 'failed').length;

    const findings = await this.dataSource
      .getRepository(Finding)
      .count({ where: { projectId: id } });

    const recentActivity = await this.dataSource.getRepository(AuditEvent).find({
      where: { projectId: id },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const pendingApprovalItems = await this.pendingApprovalItems(id);

    return {
      workflowSummary: summary,
      pendingApprovals: pendingApprovalItems,
      recentRuns: runs.map((r) => ({
        id: r.id,
        status: r.status,
        browser: r.browser,
        headed: r.headed,
        mode: r.mode,
        runScope: r.runScope,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        metrics: r.metrics,
      })),
      passRate: {
        total: results.length,
        passed,
        failed,
        percent: results.length
          ? Math.round((passed / results.length) * 100)
          : 0,
      },
      defects: findings,
      recentActivity,
    };
  }

  private async pendingApprovalItems(
    projectId: string,
  ): Promise<Record<string, unknown>[]> {
    const where = {
      projectId,
      approvalStatus: 'pending',
    } as FindOptionsWhere<ObjectLiteral>;
    const [plans, cases, artifacts] = await Promise.all([
      this.dataSource.getRepository(TestPlan).find({ where, take: 10 }),
      this.dataSource.getRepository(TestCase).find({ where, take: 10 }),
      this.dataSource.getRepository(GeneratedArtifact).find({
        where: { ...where, status: 'active' } as FindOptionsWhere<ObjectLiteral>,
        take: 10,
      }),
    ]);
    return [
      ...plans.map((p) => ({
        resourceType: 'test_plan',
        resourceId: p.id,
        title: p.title,
        version: p.version,
      })),
      ...cases.map((c) => ({
        resourceType: 'test_case',
        resourceId: c.id,
        title: `${c.humanId ? `${c.humanId} - ` : ''}${c.title}`,
        version: c.version,
      })),
      ...artifacts.map((a) => ({
        resourceType: 'automation',
        resourceId: a.id,
        title: a.path,
        version: a.version,
      })),
    ];
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
      ...(dto.apiBaseUrl !== undefined ? { apiBaseUrl: dto.apiBaseUrl } : {}),
      ...(dto.allowedDomains !== undefined
        ? { allowedDomains: dto.allowedDomains }
        : {}),
      ...(dto.repository !== undefined
        ? { repository: this.canonicalRepository(dto.repository) }
        : {}),
      ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.llmType !== undefined ? { llmType: dto.llmType } : {}),
      ...(dto.llmModel !== undefined ? { llmModel: dto.llmModel } : {}),
      ...(dto.llmTemperature !== undefined
        ? { llmTemperature: dto.llmTemperature }
        : {}),
      ...(dto.cloudProvider !== undefined
        ? { cloudProvider: dto.cloudProvider }
        : {}),
      ...(dto.cloudModel !== undefined ? { cloudModel: dto.cloudModel } : {}),
      ...(dto.cloudBaseUrl !== undefined
        ? { cloudBaseUrl: dto.cloudBaseUrl }
        : {}),
      ...(dto.runner !== undefined ? { runner: dto.runner } : {}),
      ...(dto.tcZeroPad !== undefined ? { tcZeroPad: dto.tcZeroPad } : {}),
    });
    // A blank cloudApiKey means "keep the saved key"; only a non-empty value
    // replaces it (sealed, never stored in plaintext).
    if (dto.cloudApiKey) {
      project.cloudApiKeyEnc = this.secretBox.seal(dto.cloudApiKey);
      project.hasCloudApiKey = true;
    }
    this.assertLlmConfigComplete(project);
    const saved = await this.projects.save(project);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'project.update',
      resourceType: 'project',
      resourceId: id,
      projectId: id,
      // Field names only — never DTO values (the API key must not reach audit).
      metadata: { changes: Object.keys(dto) },
      correlationId,
    });
    return this.sanitize(saved);
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
      .innerJoin(ExecutionRun, 'e', 'CAST(e.id AS varchar) = r.execution_run_id')
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
