import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { ExecutionRun, GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { MembershipService } from '../../common/access/membership.service';
import { DispatchWorkflowDto } from './dto/ci.dto';

/**
 * CI integration (FR-CI-*). GITHUB_TOKEN is used server-side only and never
 * returned to the browser (FR-CI-004). When no token/repository is configured
 * (e.g. dev), the dispatch is simulated and clearly flagged.
 */
@Injectable()
export class CiService {
  private readonly logger = new Logger(CiService.name);

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
  ) {}

  private get githubToken(): string {
    return this.config.get<AppConfig['githubToken']>('githubToken') || '';
  }

  async dispatch(
    dto: DispatchWorkflowDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    await this.membership.ensureMember(dto.projectId, user);
    const project = await this.projects.findOne({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundAppException(`Project ${dto.projectId} not found`);

    // Gate: at least one approved + validated automation artefact must exist.
    const ready = await this.artifacts.count({
      where: {
        projectId: dto.projectId,
        status: 'active',
        approvalStatus: 'approved',
        validationStatus: 'passed',
      },
    });
    if (ready === 0) {
      await this.audit.record({
        actor: user.email,
        actorId: user.id,
        action: 'ci.dispatch',
        resourceType: 'project',
        resourceId: dto.projectId,
        projectId: dto.projectId,
        result: 'denied',
        correlationId,
        metadata: { reason: 'no_approved_validated_automation' },
      });
      throw new ConflictAppException(
        'Cannot dispatch CI: no approved + validated automation exists for this project.',
        'approval_required',
      );
    }

    const run = await this.runs.save(
      this.runs.create({
        projectId: dto.projectId,
        mode: 'ci',
        status: 'running',
        environment: 'ci',
        browser: 'chromium',
        correlationId: correlationId || '',
        startedAt: new Date(),
        createdBy: user.id,
      }),
    );

    let mode = 'simulated';
    let ciUrl = '';
    if (this.githubToken && project.repository.includes('/')) {
      try {
        const workflow = dto.workflow || 'qa.yml';
        const ref = dto.ref || 'main';
        await axios.post(
          `https://api.github.com/repos/${project.repository}/actions/workflows/${workflow}/dispatches`,
          { ref },
          {
            headers: {
              Authorization: `Bearer ${this.githubToken}`,
              Accept: 'application/vnd.github+json',
            },
            timeout: 15_000,
          },
        );
        mode = 'dispatched';
        ciUrl = `https://github.com/${project.repository}/actions`;
      } catch (err) {
        this.logger.warn(`GitHub dispatch failed: ${(err as Error).message}`);
        mode = 'dispatch-failed';
      }
    }

    run.ciRunId = run.id;
    run.ciUrl = ciUrl;
    await this.runs.save(run);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ci.dispatch',
      resourceType: 'project',
      resourceId: dto.projectId,
      projectId: dto.projectId,
      correlationId,
      metadata: { ciRunId: run.id, mode },
    });

    this.events.emit({
      type: 'ci.status',
      projectId: dto.projectId,
      correlationId,
      payload: { ciRunId: run.id, status: 'running', mode },
    });

    return { ciRunId: run.id, status: 'running', mode, ciUrl };
  }

  async getRun(id: string, user: AuthUser): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundAppException(`CI run ${id} not found`);
    await this.membership.ensureMember(run.projectId, user);
    return run;
  }

  async importRun(
    id: string,
    body: { metrics?: Record<string, unknown>; status?: string },
    user: AuthUser,
    correlationId?: string,
  ): Promise<ExecutionRun> {
    const run = await this.getRun(id, user);
    run.metrics = body.metrics || run.metrics || {};
    run.status = (body.status as ExecutionRun['status']) || 'completed';
    run.finishedAt = new Date();
    const saved = await this.runs.save(run);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'ci.import',
      resourceType: 'execution',
      resourceId: id,
      projectId: run.projectId,
      correlationId,
      metadata: { status: run.status },
    });
    this.events.emit({
      type: 'ci.status',
      projectId: run.projectId,
      correlationId,
      payload: { ciRunId: id, status: run.status },
    });
    return saved;
  }
}
