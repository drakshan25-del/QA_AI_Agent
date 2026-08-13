import { Not } from 'typeorm';
import { RegressionService } from './regression.service';
import { ValidationFailedException } from '../../common/errors';
import { AuthUser } from '../../common/decorators';
import { RegressionCompareResult } from '../../engine/engine.client';

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

const compareResult: RegressionCompareResult = {
  regressions: ['tests/test_login.py::test_login'],
  fixes: [],
  still_failing: [],
  skipped: [],
  new_tests: [],
  missing_tests: [],
  stable_passes: 3,
  summary: {
    baseline_total: 4,
    current_total: 4,
    regressed: 1,
    fixed: 0,
    still_failing: 0,
    new: 0,
    missing: 0,
    has_regressions: true,
  },
};

describe('RegressionService', () => {
  let comparisons: AnyRepo;
  let runs: AnyRepo;
  let results: AnyRepo;
  let membership: { ensureMember: jest.Mock };
  let audit: { record: jest.Mock };
  let engine: { regressionCompare: jest.Mock };
  let service: RegressionService;

  const user: AuthUser = {
    id: 'u1',
    email: 'qa@example.com',
    role: 'qa_engineer',
  };

  beforeEach(() => {
    comparisons = repoMock();
    runs = repoMock();
    results = repoMock();
    membership = { ensureMember: jest.fn(async () => undefined) };
    audit = { record: jest.fn(async () => ({})) };
    engine = { regressionCompare: jest.fn(async () => compareResult) };
    service = new RegressionService(
      comparisons as never,
      runs as never,
      results as never,
      membership as never,
      audit as never,
      engine as never,
    );
  });

  it('compares two runs, persists the result and returns hasRegressions', async () => {
    runs.findOne.mockImplementation(async ({ where }) => ({
      id: where.id,
      projectId: 'p1',
    }));
    results.find.mockImplementation(async ({ where }) => [
      {
        executionRunId: where.executionRunId,
        nodeId: 'tests/test_login.py::test_login',
        outcome: where.executionRunId === 'base' ? 'passed' : 'failed',
      },
    ]);

    const saved = await service.compare(
      'p1',
      { baselineRunId: 'base', candidateRunId: 'cand' },
      user,
      'corr-1',
    );

    expect(engine.regressionCompare).toHaveBeenCalledWith(
      {
        baseline: [
          { node_id: 'tests/test_login.py::test_login', outcome: 'passed' },
        ],
        current: [
          { node_id: 'tests/test_login.py::test_login', outcome: 'failed' },
        ],
      },
      'corr-1',
    );
    expect(comparisons.save).toHaveBeenCalled();
    expect(saved).toMatchObject({
      projectId: 'p1',
      baselineRunId: 'base',
      candidateRunId: 'cand',
      hasRegressions: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'regression.compare',
        resourceType: 'regression_comparison',
      }),
    );
  });

  it('rejects a run that belongs to another project', async () => {
    runs.findOne.mockImplementation(async ({ where }) => ({
      id: where.id,
      projectId: where.id === 'base' ? 'p1' : 'other-project',
    }));

    await expect(
      service.compare(
        'p1',
        { baselineRunId: 'base', candidateRunId: 'cand' },
        user,
      ),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(engine.regressionCompare).not.toHaveBeenCalled();
    expect(comparisons.save).not.toHaveBeenCalled();
  });

  it('promotes a baseline and clears the flag on all other project runs', async () => {
    runs.findOne.mockResolvedValue({
      id: 'run-1',
      projectId: 'p1',
      isBaseline: false,
    });

    const saved = await service.promoteBaseline('run-1', user, 'corr-2');

    expect(runs.update).toHaveBeenCalledWith(
      { projectId: 'p1', id: Not('run-1') },
      { isBaseline: false },
    );
    expect(saved).toMatchObject({ id: 'run-1', isBaseline: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'execution.baseline' }),
    );
  });
});
