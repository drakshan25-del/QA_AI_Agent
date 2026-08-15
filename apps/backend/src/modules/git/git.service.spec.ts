import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AppException } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { GitService, redactToken } from './git.service';
import { normalizeRepoSlug } from './repo-slug.util';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

const execMock = execFileSync as jest.Mock;

/** Route mocked git calls by subcommand; unlisted commands succeed silently. */
function gitBehavior(
  overrides: Record<string, (args: string[]) => string> = {},
): void {
  execMock.mockImplementation((_cmd: string, args: string[]) => {
    const handler = overrides[args[0]];
    return Buffer.from(handler ? handler(args) : '');
  });
}

function gitFailure(subcommand: string, message: string, stderr = ''): void {
  execMock.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === subcommand) {
      throw Object.assign(new Error(message), { stderr: Buffer.from(stderr) });
    }
    return Buffer.from('');
  });
}

describe('normalizeRepoSlug', () => {
  it.each([
    ['owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['https://www.github.com/owner/repo/', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['  owner/repo  ', 'owner/repo'],
    ['owner/repo.name-1', 'owner/repo.name-1'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeRepoSlug(input)).toBe(expected);
  });

  it.each(['', '   ', 'just-a-name', 'a/b/c', 'https://gitlab.com/o/r', null, undefined])(
    'rejects %s',
    (input) => {
      expect(normalizeRepoSlug(input as string | null | undefined)).toBeNull();
    },
  );
});

describe('redactToken', () => {
  it('strips the token and any token-bearing URL', () => {
    const msg =
      "fatal: unable to access 'https://x-access-token:tok123@github.com/o/r.git/'; token tok123 leaked";
    const out = redactToken(msg, 'tok123');
    expect(out).not.toContain('tok123');
    expect(out).toContain('https://***@github.com');
  });
});

describe('GitService.push', () => {
  const user = { id: 'u1', email: 'qa@example.com', role: 'admin' } as AuthUser;
  const uploadDir = mkdtempSync(join(tmpdir(), 'git-push-spec-'));

  const testFile = {
    id: 'a1',
    path: 'tests/test_login.py',
    content: 'def test_login(): pass',
    kind: 'test_file',
    status: 'active',
    approvalStatus: 'approved',
    validationStatus: 'passed',
  } as GeneratedArtifact;
  const pageObject = {
    id: 'p1',
    path: 'pages/login_page.py',
    content: 'class LoginPage: pass',
    kind: 'page_object',
    status: 'active',
    approvalStatus: 'pending',
    validationStatus: 'pending',
  } as GeneratedArtifact;
  const reservedPageObject = {
    ...pageObject,
    id: 'p2',
    path: 'pages/__init__.py',
  } as GeneratedArtifact;

  let audit: { record: jest.Mock };
  let artifactsFind: jest.Mock;
  let service: GitService;
  let repository: string;
  let githubToken: string;

  function build(): GitService {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    artifactsFind = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.kind === 'test_file') return [testFile];
      if (where.kind === 'page_object') return [pageObject, reservedPageObject];
      return [];
    });
    return new GitService(
      {
        findOne: jest.fn(async () => ({ id: 'proj-1', repository })),
      } as unknown as Repository<Project>,
      { find: artifactsFind } as unknown as Repository<GeneratedArtifact>,
      {
        ensureMember: jest.fn().mockResolvedValue(undefined),
      } as unknown as MembershipService,
      audit as unknown as AuditService,
      {
        get: (key: string) =>
          ({ uploadDir, githubToken } as Record<string, string>)[key],
      } as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    repository = 'owner/repo';
    githubToken = 'tok123';
    execMock.mockReset();
    gitBehavior();
    service = build();
  });

  it('refuses with repo_not_configured when the project has no repository', async () => {
    repository = '';
    service = build();
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'repo_not_configured',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'git.push', result: 'denied' }),
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  it('refuses with repo_invalid for an unparseable repository value', async () => {
    repository = 'not a repo at all';
    service = build();
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'repo_invalid',
    });
  });

  it('refuses with github_token_missing when GITHUB_TOKEN is unset', async () => {
    githubToken = '';
    service = build();
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'github_token_missing',
    });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('refuses with approval_required when no eligible test files exist', async () => {
    service = build();
    artifactsFind.mockImplementation(async ({ where }) =>
      where.kind === 'test_file' ? [] : [pageObject],
    );
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'approval_required',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        metadata: expect.objectContaining({ reason: 'no_approved_validated_automation' }),
      }),
    );
  });

  it('refuses when a narrowed path is not approved+validated', async () => {
    artifactsFind.mockImplementation(async () => [
      { ...testFile, approvalStatus: 'pending' },
    ]);
    await expect(
      service.push('proj-1', { paths: [testFile.path] }, user),
    ).rejects.toMatchObject({ code: 'approval_required' });
  });

  it('pushes eligible test files plus active page objects, skipping reserved basenames', async () => {
    gitBehavior({
      status: () => ' M tests/test_login.py',
      'rev-parse': () => 'abc123def456',
    });
    const result = await service.push('proj-1', {}, user);
    expect(result).toMatchObject({
      branch: 'main',
      mode: 'pushed',
      pushed: true,
      sha: 'abc123def456',
      repoUrl: 'https://github.com/owner/repo',
    });
    expect(result.committed).toEqual(['tests/test_login.py', 'pages/login_page.py']);
    const pushCall = execMock.mock.calls.find((c) => c[1][0] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall![1]).toContain('HEAD:refs/heads/main');
    expect(pushCall![1]).not.toContain('--force');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'git.push',
        metadata: expect.objectContaining({ repo: 'owner/repo', pushed: true }),
      }),
    );
  });

  it('accepts overridden validation as validated (human sign-off)', async () => {
    artifactsFind.mockImplementation(async () => [
      { ...testFile, validationStatus: 'overridden' },
    ]);
    gitBehavior({
      status: () => ' M tests/test_login.py',
      'rev-parse': () => 'abc123',
    });
    const result = await service.push('proj-1', { paths: [testFile.path] }, user);
    expect(result.mode).toBe('pushed');
    expect(result.committed).toEqual(['tests/test_login.py']);
  });

  it('queries eligible test files with the widened validation set', async () => {
    gitBehavior({ status: () => '' });
    await service.push('proj-1', {}, user);
    const [query] = artifactsFind.mock.calls[0] as [
      { where: { validationStatus: { value: string[] } } },
    ];
    expect(query.where.validationStatus.value).toEqual([
      'passed',
      'passed_with_warnings',
      'overridden',
    ]);
  });

  it('short-circuits with no-changes when the tree matches the remote', async () => {
    gitBehavior({ status: () => '' });
    const result = await service.push('proj-1', {}, user);
    expect(result.mode).toBe('no-changes');
    expect(result.pushed).toBe(false);
    expect(result.warning).toMatch(/nothing to push/i);
    const subcommands = execMock.mock.calls.map((c) => c[1][0]);
    expect(subcommands).not.toContain('commit');
    expect(subcommands).not.toContain('push');
  });

  it('maps fetch auth failures to github_auth_failed', async () => {
    gitFailure('fetch', 'exit 128', 'remote: Repository not found.');
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'github_auth_failed',
    });
  });

  it('treats a missing remote main as an empty repo and still pushes', async () => {
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'fetch') {
        throw Object.assign(new Error('exit 128'), {
          stderr: Buffer.from("fatal: couldn't find remote ref main"),
        });
      }
      if (args[0] === 'status') return Buffer.from(' M tests/test_login.py');
      if (args[0] === 'rev-parse') return Buffer.from('feedbeef');
      return Buffer.from('');
    });
    const result = await service.push('proj-1', {}, user);
    expect(result.mode).toBe('pushed');
    expect(result.sha).toBe('feedbeef');
  });

  it('maps a rejected push to push_rejected (409)', async () => {
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'push') {
        throw Object.assign(new Error('exit 1'), {
          stderr: Buffer.from('! [rejected] main -> main (non-fast-forward)'),
        });
      }
      if (args[0] === 'status') return Buffer.from(' M x');
      if (args[0] === 'rev-parse') return Buffer.from('abc');
      return Buffer.from('');
    });
    const err = await service.push('proj-1', {}, user).catch((e) => e as AppException);
    expect(err).toMatchObject({ code: 'push_rejected' });
    expect((err as AppException).getStatus()).toBe(409);
  });

  it('never leaks the token through git error messages', async () => {
    gitFailure(
      'fetch',
      "fatal: unable to access 'https://x-access-token:tok123@github.com/owner/repo.git/': Could not resolve host",
    );
    const err = await service.push('proj-1', {}, user).catch((e) => e as Error);
    expect(err).toBeInstanceOf(AppException);
    expect((err as Error).message).not.toContain('tok123');
  });

  it('rejects artifact paths that touch the .git directory', async () => {
    artifactsFind.mockImplementation(async ({ where }) =>
      where.kind === 'test_file'
        ? [{ ...testFile, path: '.git/hooks/pre-commit' }]
        : [],
    );
    await expect(service.push('proj-1', {}, user)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
