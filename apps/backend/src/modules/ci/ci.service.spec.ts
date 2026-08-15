import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import axios from 'axios';
import { ExecutionRun, GeneratedArtifact, Project } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { MembershipService } from '../../common/access/membership.service';
import { CiService } from './ci.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const postMock = axios.post as jest.Mock;

describe('CiService.dispatch', () => {
  const user = { id: 'u1', email: 'qa@example.com', role: 'admin' } as AuthUser;

  let repository: string;
  let githubToken: string;
  let runsSave: jest.Mock;
  let audit: { record: jest.Mock };
  let service: CiService;

  function build(): CiService {
    runsSave = jest.fn(async (r: Partial<ExecutionRun>) => ({
      ...r,
      id: r.id ?? 'run-1',
    }));
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    return new CiService(
      {
        findOne: jest.fn(async () => ({ id: 'proj-1', repository })),
      } as unknown as Repository<Project>,
      { count: jest.fn(async () => 1) } as unknown as Repository<GeneratedArtifact>,
      {
        create: jest.fn((r: Partial<ExecutionRun>) => r),
        save: runsSave,
      } as unknown as Repository<ExecutionRun>,
      {
        ensureMember: jest.fn().mockResolvedValue(undefined),
      } as unknown as MembershipService,
      audit as unknown as AuditService,
      { emit: jest.fn() } as unknown as EventsService,
      {
        get: (key: string) => ({ githubToken } as Record<string, string>)[key],
      } as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    repository = 'owner/repo';
    githubToken = 'tok123';
    postMock.mockReset();
    service = build();
  });

  it('refuses with repo_not_configured before creating a run row', async () => {
    repository = '';
    service = build();
    await expect(
      service.dispatch({ projectId: 'proj-1' }, user),
    ).rejects.toMatchObject({ code: 'repo_not_configured' });
    expect(runsSave).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ci.dispatch', result: 'denied' }),
    );
  });

  it('refuses with github_token_missing before creating a run row', async () => {
    githubToken = '';
    service = build();
    await expect(
      service.dispatch({ projectId: 'proj-1' }, user),
    ).rejects.toMatchObject({ code: 'github_token_missing' });
    expect(runsSave).not.toHaveBeenCalled();
  });

  it('dispatches against the normalized slug when a GitHub URL is stored', async () => {
    repository = 'https://github.com/owner/repo.git';
    service = build();
    postMock.mockResolvedValue({ status: 204 });
    const result = await service.dispatch({ projectId: 'proj-1' }, user);
    expect(result).toMatchObject({
      mode: 'dispatched',
      ciUrl: 'https://github.com/owner/repo/actions',
    });
    expect(postMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/actions/workflows/playwright-ci.yml/dispatches',
      { ref: 'main' },
      expect.anything(),
    );
  });

  it('keeps a dispatch-failed run when GitHub refuses the request', async () => {
    postMock.mockRejectedValue(new Error('422 workflow not found'));
    const result = await service.dispatch({ projectId: 'proj-1' }, user);
    expect(result.mode).toBe('dispatch-failed');
    expect(runsSave).toHaveBeenCalledTimes(2);
  });
});
