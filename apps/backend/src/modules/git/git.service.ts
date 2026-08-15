import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  AppException,
  ConflictAppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { VALIDATION_OK_STATUSES } from '../../common/enums';
import { RESERVED_AUTOMATION_BASENAMES } from '../executions/executions.service';
import { normalizeRepoSlug } from './repo-slug.util';
import { GitCommitDto, GitPushDto } from './dto/git.dto';

export interface GitPushResult {
  branch: 'main';
  sha: string;
  pushed: boolean;
  mode: 'pushed' | 'no-changes';
  repoUrl: string;
  committed: string[];
  warning?: string;
}

/**
 * Git integration (FR-GIT-*). The backend re-verifies the approval gate itself
 * (the client `approved` flag is never trusted) and never exposes GITHUB_TOKEN
 * to the browser (FR-CI-004). `commit` records into a per-project local
 * workspace repo only; `push` syncs the remote's main branch, overlays the
 * eligible generated artifacts and pushes the diff to GitHub using the global
 * GITHUB_TOKEN (transient — the token is never written to .git/config and is
 * redacted from every error, log and audit record).
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
        !VALIDATION_OK_STATUSES.includes(a.validationStatus),
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

    // 'ai-tests/' matches both the engine's branch_prefix and the CI push
    // trigger (.github/workflows/playwright-ci.yml: branches 'ai-tests/**');
    // the previous 'qa/' prefix produced branches CI never picked up.
    const branch = `ai-tests/${(dto.branchSuffix || 'automation').replace(/[^\w.\-/]/g, '-')}`;
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

    // Artifact paths originate from engine (LLM) output and are untrusted:
    // every write must resolve inside the per-project workspace (SEC-005,
    // SRS §13.1 — tool parameters validated independently of model output).
    const workspaceRoot = resolve(workspace);
    for (const a of arts) {
      const filePath = resolve(workspaceRoot, a.path);
      if (filePath !== workspaceRoot && !filePath.startsWith(workspaceRoot + sep)) {
        throw new ValidationFailedException(
          `Artifact path '${a.path}' escapes the project git workspace`,
          { artifactId: a.id },
        );
      }
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

  /**
   * Push the eligible generated automation to the remote repository's main
   * branch (user decision: main directly, not an ai-tests/* branch). The file
   * set mirrors ExecutionsService.startRun — approved+validated test files
   * plus every active page object — so what lands in CI is exactly what an
   * execution run would use. Execution status is deliberately not part of the
   * gate.
   */
  async push(
    projectId: string,
    dto: GitPushDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<GitPushResult> {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const deny = async (reason: string, extra?: Record<string, unknown>) =>
      this.audit.record({
        actor: user.email,
        actorId: user.id,
        action: 'git.push',
        resourceType: 'project',
        resourceId: projectId,
        projectId,
        result: 'denied',
        correlationId,
        metadata: { reason, ...extra },
      });

    if (!project.repository.trim()) {
      await deny('repo_not_configured');
      throw new AppException(
        'repo_not_configured',
        "No GitHub repository is configured for this project. Set 'owner/repo' in Project Settings.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const slug = normalizeRepoSlug(project.repository);
    if (!slug) {
      await deny('repo_invalid');
      throw new AppException(
        'repo_invalid',
        `Configured repository '${project.repository}' is not a valid GitHub repository ('owner/repo' or GitHub URL).`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const token = this.config.get<string>('githubToken') || '';
    if (!token) {
      await deny('github_token_missing');
      throw new AppException(
        'github_token_missing',
        'GITHUB_TOKEN is not configured on the server. Add it to the backend environment and restart.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Gate (same rule as commit/CI dispatch): only approved + validated test
    // files leave the platform. Page objects ride along so imports resolve.
    let testFiles: GeneratedArtifact[];
    if (dto.paths?.length) {
      const requested = await this.artifacts.find({
        where: { projectId, path: In(dto.paths) },
      });
      const blocked = requested.filter(
        (a) =>
          a.status !== 'active' ||
          a.approvalStatus !== 'approved' ||
          !VALIDATION_OK_STATUSES.includes(a.validationStatus),
      );
      if (blocked.length) {
        await deny('unapproved_artifacts', { ids: blocked.map((a) => a.id) });
        throw new ConflictAppException(
          `Cannot push: ${blocked.length} artifact(s) are not approved+validated.`,
          'approval_required',
          { blocked: blocked.map((a) => a.id) },
        );
      }
      testFiles = requested.filter((a) => a.kind !== 'page_object');
    } else {
      testFiles = await this.artifacts.find({
        where: {
          projectId,
          kind: 'test_file',
          status: 'active',
          approvalStatus: 'approved',
          validationStatus: In([...VALIDATION_OK_STATUSES]),
        },
      });
    }
    if (!testFiles.length) {
      await deny('no_approved_validated_automation');
      throw new ConflictAppException(
        'Cannot push: no approved + validated automation exists for this project.',
        'approval_required',
      );
    }
    const pageObjects = await this.artifacts.find({
      where: { projectId, kind: 'page_object', status: 'active' },
    });

    const files: { path: string; content: string }[] = [];
    const byPath = new Set<string>();
    for (const a of [...testFiles, ...pageObjects]) {
      const basename = (a.path || '').split('/').pop() || '';
      if (RESERVED_AUTOMATION_BASENAMES.has(basename)) continue;
      if (a.path && a.content && !byPath.has(a.path)) {
        byPath.add(a.path);
        files.push({ path: a.path, content: a.content });
      }
    }

    const message = dto.message?.trim() || 'ci: update generated automation';
    const result = await this.withPushLock(projectId, () =>
      this.syncAndPush(projectId, slug, token, message, files),
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'git.push',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      correlationId,
      metadata: {
        branch: result.branch,
        repo: slug,
        sha: result.sha,
        pushed: result.pushed,
        mode: result.mode,
        fileCount: files.length,
      },
    });
    return result;
  }

  /**
   * Overlay-only remote sync: fetch remote main (shallow), check it out,
   * overlay the artifact files, commit only the diff and push without force.
   * Files the tool didn't write are never deleted from the remote. Uses a
   * workspace separate from the local-commit one ('git-push/' vs 'git/') —
   * that workspace's unrelated init history can never fast-forward a real
   * remote.
   */
  private async syncAndPush(
    projectId: string,
    slug: string,
    token: string,
    message: string,
    files: { path: string; content: string }[],
  ): Promise<GitPushResult> {
    const uploadDir = this.config.get<string>('uploadDir')!;
    const workspace = join(uploadDir, 'git-push', projectId);
    await fs.mkdir(workspace, { recursive: true });
    const repoUrl = `https://github.com/${slug}`;
    const authUrl = `https://x-access-token:${token}@github.com/${slug}.git`;
    const git = (args: string[]) => this.execGit(args, workspace, token);

    if (!(await this.exists(join(workspace, '.git')))) {
      git(['init', '-q']);
      git(['config', 'user.email', 'qa-agent@example.com']);
      git(['config', 'user.name', 'QA Agent']);
    }

    let remoteHasMain = true;
    try {
      git(['fetch', '--depth', '1', authUrl, 'main']);
    } catch (err) {
      const msg = (err as Error).message;
      if (/couldn'?t find remote ref|remote branch .* not found/i.test(msg)) {
        remoteHasMain = false; // empty repo — main is created by this push
      } else if (this.isAuthError(msg)) {
        throw this.authException(slug);
      } else {
        throw new AppException(
          'git_push_failed',
          `git fetch failed: ${excerpt(msg)}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }
    if (remoteHasMain) {
      git(['checkout', '-q', '-B', 'main', 'FETCH_HEAD']);
      // Purge stale leftovers from prior pushes so the committed tree is
      // exactly remote tree + fresh overlay.
      git(['clean', '-qfd']);
    } else {
      try {
        git(['checkout', '-q', '-B', 'main']);
      } catch {
        git(['symbolic-ref', 'HEAD', 'refs/heads/main']); // unborn HEAD
      }
    }

    // Artifact paths are untrusted LLM output (SEC-005): contain every write
    // inside the workspace and refuse .git segments outright — containment
    // alone would still allow .git/hooks/* writes.
    const workspaceRoot = resolve(workspace);
    for (const f of files) {
      if (f.path.split(/[\\/]+/).some((seg) => seg.toLowerCase() === '.git')) {
        throw new ValidationFailedException(
          `Artifact path '${f.path}' touches the git metadata directory`,
        );
      }
      const filePath = resolve(workspaceRoot, f.path);
      if (filePath !== workspaceRoot && !filePath.startsWith(workspaceRoot + sep)) {
        throw new ValidationFailedException(
          `Artifact path '${f.path}' escapes the push workspace`,
        );
      }
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, f.content, 'utf8');
    }

    if (!git(['status', '--porcelain'])) {
      let sha = '';
      try {
        sha = git(['rev-parse', 'HEAD']);
      } catch {
        /* unborn HEAD on a repo with nothing to push */
      }
      return {
        branch: 'main',
        sha,
        pushed: false,
        mode: 'no-changes',
        repoUrl,
        committed: [],
        warning: 'Remote main already up to date — nothing to push.',
      };
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    git(['branch', '-M', 'main']);
    const sha = git(['rev-parse', 'HEAD']);

    try {
      git(['push', authUrl, 'HEAD:refs/heads/main']);
    } catch (err) {
      const msg = (err as Error).message;
      if (/protected branch/i.test(msg)) {
        throw new AppException(
          'push_rejected',
          "Push rejected: branch protection on 'main' blocks this token. Allow the token to push or adjust the protection rules.",
          HttpStatus.CONFLICT,
        );
      }
      if (/non-fast-forward|fetch first|failed to push some refs/i.test(msg)) {
        throw new AppException(
          'push_rejected',
          'Push rejected: remote main changed during the push. Retry.',
          HttpStatus.CONFLICT,
        );
      }
      if (this.isAuthError(msg)) throw this.authException(slug);
      throw new AppException(
        'git_push_failed',
        `git push failed: ${excerpt(msg)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      branch: 'main',
      sha,
      pushed: true,
      mode: 'pushed',
      repoUrl,
      committed: files.map((f) => f.path),
    };
  }

  /** Serialize pushes per project — concurrent syncs would corrupt the workspace. */
  private readonly pushLocks = new Map<string, Promise<unknown>>();

  private async withPushLock<T>(
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.pushLocks.get(projectId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const settled = run.catch(() => undefined);
    this.pushLocks.set(projectId, settled);
    try {
      return await run;
    } finally {
      if (this.pushLocks.get(projectId) === settled) {
        this.pushLocks.delete(projectId);
      }
    }
  }

  private execGit(args: string[], cwd: string, token: string): string {
    try {
      return execFileSync('git', args, {
        cwd,
        stdio: 'pipe',
        timeout: 60_000,
      })
        .toString()
        .trim();
    } catch (err) {
      const e = err as Error & { stderr?: Buffer | string };
      const stderr = e.stderr?.toString() ?? '';
      throw new Error(redactToken(`${e.message}\n${stderr}`.trim(), token));
    }
  }

  private isAuthError(msg: string): boolean {
    return /authentication failed|repository not found|access denied|\b(401|403)\b/i.test(
      msg,
    );
  }

  private authException(slug: string): AppException {
    // GitHub answers 'Repository not found' for missing repos AND for tokens
    // without access — the message has to cover both.
    return new AppException(
      'github_auth_failed',
      `GitHub rejected access to '${slug}'. The repository may not exist, or GITHUB_TOKEN lacks access (private repos need the Contents: read/write permission or 'repo' scope).`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

/** Keep the token (and any token-bearing URL) out of errors, logs and audit. */
export function redactToken(text: string, token: string): string {
  if (!text) return text;
  let out = token ? text.split(token).join('***') : text;
  out = out.replace(/https:\/\/[^@\s]+@github\.com/gi, 'https://***@github.com');
  return out;
}

function excerpt(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
