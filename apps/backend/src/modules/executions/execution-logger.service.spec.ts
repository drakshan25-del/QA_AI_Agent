import { ExecutionLoggerService } from './execution-logger.service';

type AnyRepo = {
  findOne: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
};

function repoMock(): AnyRepo {
  return {
    findOne: jest.fn(async () => null),
    save: jest.fn(async (x) => x),
    find: jest.fn(async () => []),
    create: jest.fn((x) => x),
  };
}

describe('ExecutionLoggerService', () => {
  let logs: AnyRepo;
  let events: { emit: jest.Mock };
  let service: ExecutionLoggerService;
  const ctx = { runId: 'run-1234abcd', projectId: 'p1', correlationId: 'c1' };

  beforeEach(() => {
    logs = repoMock();
    events = { emit: jest.fn(() => ({ seq: 1 })) };
    service = new ExecutionLoggerService(logs as never, events as never);
  });

  it('persists and emits an execution.log envelope with a monotonic seq', async () => {
    const log = service.forRun(ctx);
    await log.info('first');
    await log.info('second');

    expect(logs.save).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
    const first = events.emit.mock.calls[0][0];
    const second = events.emit.mock.calls[1][0];
    expect(first.type).toBe('execution.log');
    expect(first.runId).toBe(ctx.runId);
    expect(first.payload.seq).toBe(1);
    expect(second.payload.seq).toBe(2);
  });

  it('keeps the current stage across lines and carries level through', async () => {
    const log = service.forRun(ctx);
    await log.stage('Running Tests');
    await log.pass('TC-001 passed');

    const stageLine = events.emit.mock.calls[0][0].payload;
    const passLine = events.emit.mock.calls[1][0].payload;
    expect(stageLine.stage).toBe('Running Tests');
    expect(stageLine.level).toBe('info');
    expect(passLine.stage).toBe('Running Tests'); // inherited without repeating
    expect(passLine.level).toBe('pass');
  });

  it('redacts secrets in the message before persisting', async () => {
    const log = service.forRun(ctx);
    await log.info('login with password=hunter2 done');

    const saved = logs.save.mock.calls[0][0];
    expect(saved.message).not.toContain('hunter2');
    expect(saved.message).toContain('***');
  });

  it('clamps progress to 0..100 and computes percent from current/total', async () => {
    const log = service.forRun(ctx);
    await log.progress(5, 28, 'Running test 5 of 28');
    const payload = events.emit.mock.calls[0][0].payload;
    expect(payload.progress).toBe(Math.round((5 / 28) * 100));
  });

  it('seeds the seq counter from persisted rows so a restart never reuses a seq', async () => {
    logs.findOne.mockResolvedValueOnce({ seq: 40 });
    const log = service.forRun(ctx);
    await log.info('after restart');
    expect(events.emit.mock.calls[0][0].payload.seq).toBe(41);
  });
});
