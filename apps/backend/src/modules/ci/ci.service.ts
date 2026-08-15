import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { ExecutionRun, GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  AppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { MembershipService } from '../../common/access/membership.service';
import { VALIDATION_OK_STATUSES } from '../../common/enums';
import { normalizeRepoSlug } from '../git/repo-slug.util';
import { DispatchWorkflowDto } from './dto/ci.dto';

/**
 * CI integration (FR-CI-*). GITHUB_TOKEN is used server-side only and never
 * returned to the browser (FR-CI-004). A missing repository or token is a
 * 400 with an actionable message — never a silently simulated run.
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
        validationStatus: In([...VALIDATION_OK_STATUSES]),
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

    // Configuration problems are the caller's to fix — refuse before creating
    // a run row instead of recording a phantom 'simulated' run.
    const deny = async (reason: string) =>
      this.audit.record({
        actor: user.email,
        actorId: user.id,
        action: 'ci.dispatch',
        resourceType: 'project',
        resourceId: dto.projectId,
        projectId: dto.projectId,
        result: 'denied',
        correlationId,
        metadata: { reason },
      });
    const slug = normalizeRepoSlug(project.repository);
    if (!slug) {
      await deny('repo_not_configured');
      throw new AppException(
        'repo_not_configured',
        "No GitHub repository is configured for this project. Set 'owner/repo' in Project Settings.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.githubToken) {
      await deny('github_token_missing');
      throw new AppException(
        'github_token_missing',
        'GITHUB_TOKEN is not configured on the server, so a GitHub Actions dispatch is impossible. Add it to the backend environment and restart.',
        HttpStatus.BAD_REQUEST,
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

    let mode: string;
    let ciUrl = '';
    try {
      // Default to the workflow that actually exists in this repository
      // (.github/workflows/playwright-ci.yml) — 'qa.yml' would 404.
      const workflow = dto.workflow || 'playwright-ci.yml';
      const ref = dto.ref || 'main';
      await axios.post(
        `https://api.github.com/repos/${slug}/actions/workflows/${workflow}/dispatches`,
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
      ciUrl = `https://github.com/${slug}/actions`;
    } catch (err) {
      this.logger.warn(`GitHub dispatch failed: ${(err as Error).message}`);
      mode = 'dispatch-failed';
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
    return Object.assign(run, { ciStatus: ciStateOf(run.status) });
  }

  /** CI run history for the project CI panel (FR-V3-CI-002). */
  async listRuns(projectId: string, user: AuthUser): Promise<ExecutionRun[]> {
    await this.membership.ensureMember(projectId, user);
    const runs = await this.runs.find({
      where: { projectId, mode: 'ci' },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return runs.map((r) => Object.assign(r, { ciStatus: ciStateOf(r.status) }));
  }

  /**
   * Import CI results into the platform run record without duplication
   * (FR-V3-CI-003): re-importing updates the same run.
   */
  async importRun(
    id: string,
    body: { metrics?: Record<string, unknown>; status?: string },
    user: AuthUser,
    correlationId?: string,
  ): Promise<ExecutionRun> {
    const run = await this.getRun(id, user);
    run.metrics = body.metrics || run.metrics || {};
    run.status = normaliseCiConclusion(body.status);
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
      metadata: { status: run.status, ciStatus: ciStateOf(run.status) },
    });
    this.events.emit({
      type: 'ci.status',
      projectId: run.projectId,
      correlationId,
      payload: { ciRunId: id, status: run.status, ciStatus: ciStateOf(run.status) },
    });
    return Object.assign(saved, { ciStatus: ciStateOf(saved.status) });
  }
}

/** Map a stored execution status onto the §23.7 CI/CD state machine. */
function ciStateOf(status: ExecutionRun['status']): string {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'preparing':
    case 'running':
    case 'stopping':
      return 'in_progress';
    case 'passed':
    case 'completed':
      return 'successful';
    case 'failed':
    case 'partially_passed':
    case 'error':
    case 'timed_out':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'not_triggered';
  }
}

/** GitHub conclusions (success/failure/cancelled/…) → execution status. */
function normaliseCiConclusion(status?: string): ExecutionRun['status'] {
  switch ((status || '').toLowerCase()) {
    case 'success':
    case 'passed':
    case 'completed':
      return 'passed';
    case 'failure':
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timed_out';
    default:
      return 'passed';
  }
}
