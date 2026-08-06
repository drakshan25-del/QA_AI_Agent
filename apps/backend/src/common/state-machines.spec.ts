import {
  CI_RUN_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  JOB_TRANSITIONS,
  VALIDATION_TRANSITIONS,
  assertTransition,
  canTransition,
  deriveArtefactState,
  isTerminalExecutionStatus,
  isTerminalJobStatus,
  outcomeFromMetrics,
} from './state-machines';
import { ConflictAppException } from './errors';
import { formatTestCaseId } from '../modules/test-cases/test-cases.service';

describe('V3 state machines (§23.7)', () => {
  it('allows the documented generation-job lifecycle', () => {
    expect(canTransition(JOB_TRANSITIONS, 'queued', 'running')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'running', 'completed')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'running', 'completed_with_warnings')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'running', 'timed_out')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'queued', 'cancelled')).toBe(true);
  });

  it('rejects invalid job transitions with a 409', () => {
    expect(() =>
      assertTransition(JOB_TRANSITIONS, 'job', 'completed', 'running'),
    ).toThrow(ConflictAppException);
    expect(canTransition(JOB_TRANSITIONS, 'failed', 'completed')).toBe(false);
  });

  it('models the execution run lifecycle including stopping and partial passes', () => {
    expect(canTransition(EXECUTION_TRANSITIONS, 'queued', 'preparing')).toBe(true);
    expect(canTransition(EXECUTION_TRANSITIONS, 'preparing', 'running')).toBe(true);
    expect(canTransition(EXECUTION_TRANSITIONS, 'running', 'stopping')).toBe(true);
    expect(canTransition(EXECUTION_TRANSITIONS, 'stopping', 'cancelled')).toBe(true);
    expect(canTransition(EXECUTION_TRANSITIONS, 'running', 'partially_passed')).toBe(true);
    expect(canTransition(EXECUTION_TRANSITIONS, 'passed', 'running')).toBe(false);
  });

  it('models validation including passed-with-warnings and override', () => {
    expect(canTransition(VALIDATION_TRANSITIONS, 'not_started', 'running')).toBe(true);
    expect(canTransition(VALIDATION_TRANSITIONS, 'running', 'passed_with_warnings')).toBe(true);
    expect(canTransition(VALIDATION_TRANSITIONS, 'failed', 'overridden')).toBe(true);
    expect(canTransition(VALIDATION_TRANSITIONS, 'not_started', 'passed')).toBe(false);
  });

  it('models CI run states', () => {
    expect(canTransition(CI_RUN_TRANSITIONS, 'queued', 'in_progress')).toBe(true);
    expect(canTransition(CI_RUN_TRANSITIONS, 'in_progress', 'successful')).toBe(true);
    expect(canTransition(CI_RUN_TRANSITIONS, 'successful', 'queued')).toBe(false);
  });

  it('knows terminal states', () => {
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('running')).toBe(false);
    expect(isTerminalExecutionStatus('partially_passed')).toBe(true);
    expect(isTerminalExecutionStatus('stopping')).toBe(false);
  });

  it('derives the §23.7 artefact lifecycle state from stored columns', () => {
    expect(
      deriveArtefactState({ approvalStatus: 'approved', approvalInvalidated: false }),
    ).toBe('approved');
    expect(deriveArtefactState({ approvalStatus: 'rejected' })).toBe('rejected');
    expect(
      deriveArtefactState({ approvalStatus: 'pending', approvalInvalidated: true }),
    ).toBe('under_review');
    expect(
      deriveArtefactState({ approvalStatus: 'approved', status: 'superseded' }),
    ).toBe('superseded');
  });

  it('reconciles run outcome from metrics (FR-V3-RPT-001)', () => {
    expect(outcomeFromMetrics({ passed: 3, failed: 0 })).toBe('passed');
    expect(outcomeFromMetrics({ passed: 0, failed: 2 })).toBe('failed');
    expect(outcomeFromMetrics({ passed: 2, failed: 1 })).toBe('partially_passed');
    expect(outcomeFromMetrics({ passed: 2, errors: 1 })).toBe('partially_passed');
  });

  it('never reports green from empty/missing metrics (no false pass)', () => {
    expect(outcomeFromMetrics({})).toBe('failed');
    expect(outcomeFromMetrics({ total: 0 })).toBe('failed');
    expect(outcomeFromMetrics({ passed: 0, failed: 0 })).toBe('failed');
  });
});

describe('TC-{int} identifiers (FR-V3-TC-001/004)', () => {
  it('formats plain incremental IDs', () => {
    expect(formatTestCaseId(1)).toBe('TC-1');
    expect(formatTestCaseId(42)).toBe('TC-42');
  });

  it('supports optional zero padding while keeping the canonical value', () => {
    expect(formatTestCaseId(1, 4)).toBe('TC-0001');
    expect(formatTestCaseId(1234, 4)).toBe('TC-1234');
    expect(formatTestCaseId(12345, 4)).toBe('TC-12345');
  });
});
