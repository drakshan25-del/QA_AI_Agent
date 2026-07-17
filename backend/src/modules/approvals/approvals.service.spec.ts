import { ApprovalsService } from './approvals.service';
import { ConflictAppException } from '../../common/errors';
import { AuthUser } from '../../common/decorators';

type AnyRepo = { findOne: jest.Mock; save: jest.Mock; find: jest.Mock; update: jest.Mock; create: jest.Mock };

function repoMock(): AnyRepo {
  return {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
    find: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
    create: jest.fn((x) => x),
  };
}

describe('ApprovalsService (gate)', () => {
  let approvals: AnyRepo;
  let testPlans: AnyRepo;
  let testCases: AnyRepo;
  let artifacts: AnyRepo;
  let audit: { record: jest.Mock };
  let events: { emit: jest.Mock };
  let service: ApprovalsService;

  const user: AuthUser = {
    id: 'u1',
    email: 'qa@example.com',
    role: 'qa_engineer',
  };

  beforeEach(() => {
    approvals = repoMock();
    testPlans = repoMock();
    testCases = repoMock();
    artifacts = repoMock();
    audit = { record: jest.fn(async () => ({})) };
    events = { emit: jest.fn(() => ({ seq: 1 })) };
    service = new ApprovalsService(
      approvals as never,
      testPlans as never,
      testCases as never,
      artifacts as never,
      audit as never,
      events as never,
    );
  });

  it('throws 409 ConflictAppException when the resource is not approved', async () => {
    testPlans.findOne.mockResolvedValue({
      id: 'tp1',
      projectId: 'p1',
      version: 1,
      approvalStatus: 'pending',
      approvalInvalidated: false,
    });

    await expect(service.ensureApproved('test_plan', 'tp1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('throws 409 when an approved resource was invalidated by an upstream change', async () => {
    testPlans.findOne.mockResolvedValue({
      id: 'tp1',
      projectId: 'p1',
      version: 2,
      approvalStatus: 'approved',
      approvalInvalidated: true,
    });

    await expect(service.ensureApproved('test_plan', 'tp1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('passes when the resource is approved and current', async () => {
    testPlans.findOne.mockResolvedValue({
      id: 'tp1',
      projectId: 'p1',
      version: 1,
      approvalStatus: 'approved',
      approvalInvalidated: false,
    });

    await expect(service.ensureApproved('test_plan', 'tp1')).resolves.toMatchObject(
      { id: 'tp1', approvalStatus: 'approved' },
    );
  });

  it('records a decision, updates the resource and emits approval.updated', async () => {
    testPlans.findOne.mockResolvedValue({
      id: 'tp1',
      projectId: 'p1',
      version: 1,
      approvalStatus: 'pending',
      approvalInvalidated: false,
    });

    const res = await service.decide('test_plan', 'tp1', 'approved', 'lgtm', user);

    expect(res).toMatchObject({ id: 'tp1', approvalStatus: 'approved' });
    expect(testPlans.save).toHaveBeenCalled();
    expect(approvals.save).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.updated' }),
    );
  });
});
