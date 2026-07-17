import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { GitCommitDto } from './dto/git.dto';

/**
 * Git integration (FR-GIT-*). The backend re-verifies the approval gate itself
 * (the client `approved` flag is never trusted) and never exposes GITHUB_TOKEN
 * to the browser (FR-CI-004). Commits are made into a per-project local
 * workspace repo — no network push is performed in this tier (documented gap).
 */
@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async commit(
    projectId: string,
    dto: GitCommitDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const arts = await this.artifacts.find({
      where: { projectId, path: In(dto.paths) },
    });
    if (!arts.length) {
      throw new NotFoundAppException(
        'No matching automation artifacts found for the given paths',
      );
    }

    // Gate (FR-GIT / FR-AUT-010): commit only approved + validated artefacts.
    const blocked = arts.filter(
      (a) =>
        a.status !== 'active' ||
        a.approvalStatus !== 'approved' ||
        a.validationStatus !== 'passed',
    );
    if (blocked.length) {
      await this.audit.record({
        actor: user.email,
        actorId: user.id,
        action: 'git.commit',
        resourceType: 'project',
        resourceId: projectId,
        projectId,
        result: 'denied',
        correlationId,
        metadata: { reason: 'unapproved_artifacts', ids: blocked.map((a) => a.id) },
      });
      throw new ConflictAppException(
        `Cannot commit: ${blocked.length} artifact(s) are not approved+validated.`,
        'approval_required',
        { blocked: blocked.map((a) => a.id) },
      );
    }

    const branch = `qa/${(dto.branchSuffix || 'automation').replace(/[^\w.\-/]/g, '-')}`;
    const result = await this.writeAndCommit(projectId, branch, dto.message, arts);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'git.commit',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      correlationId,
      metadata: { branch, paths: dto.paths, sha: result.sha, mode: result.mode },
    });
    return result;
  }

  private async writeAndCommit(
    projectId: string,
    branch: string,
    message: string,
    arts: GeneratedArtifact[],
  ): Promise<{ branch: string; sha: string; committed: string[]; mode: string }> {
    const uploadDir = this.config.get<string>('uploadDir')!;
    const workspace = join(uploadDir, 'git', projectId);
    await fs.mkdir(workspace, { recursive: true });

    for (const a of arts) {
      const filePath = join(workspace, a.path);
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, a.content, 'utf8');
    }

    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: workspace, stdio: 'pipe' })
          .toString()
          .trim();
      if (!(await this.exists(join(workspace, '.git')))) {
        git(['init', '-q']);
        git(['config', 'user.email', 'qa-agent@example.com']);
        git(['config', 'user.name', 'QA Agent']);
      }
      try {
        git(['checkout', '-q', '-B', branch]);
      } catch {
        /* branch checkout best-effort */
      }
      git(['add', '-A']);
      git(['commit', '-q', '-m', message, '--allow-empty']);
      const sha = git(['rev-parse', 'HEAD']);
      return {
        branch,
        sha,
        committed: arts.map((a) => a.path),
        mode: 'local-workspace',
      };
    } catch (err) {
      this.logger.warn(`git commit fell back to staged mode: ${(err as Error).message}`);
      return {
        branch,
        sha: '',
        committed: arts.map((a) => a.path),
        mode: 'staged-no-git',
      };
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  hasGithubToken(): boolean {
    return !!this.config.get<AppConfig['githubToken']>('githubToken');
  }
}
