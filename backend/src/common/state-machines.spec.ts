import {
  CI_RUN_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  JOB_TRANSITIONS,
  UI_SCAN_TRANSITIONS,
  VALIDATION_TRANSITIONS,
  assertTransition,
  canTransition,
  deriveArtefactState,
  isTerminalExecutionStatus,
  isTerminalJobStatus,
  isTerminalUiScanStage,
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

describe('UI scan stages (FR-UIS-003)', () => {
  it('moves forwards through the lifecycle', () => {
    expect(canTransition(UI_SCAN_TRANSITIONS, 'QUEUED', 'STARTING_BROWSER')).toBe(true);
    expect(canTransition(UI_SCAN_TRANSITIONS, 'NAVIGATING', 'SCANNING_DOM')).toBe(true);
  });

  it('allows optional stages to be skipped', () => {
    // An anonymous scan never authenticates; screenshots can be turned off.
    expect(canTransition(UI_SCAN_TRANSITIONS, 'NAVIGATING', 'WAITING_FOR_PAGE')).toBe(
      true,
    );
    expect(
      canTransition(UI_SCAN_TRANSITIONS, 'VALIDATING_LOCATORS', 'SAVING_RESULTS'),
    ).toBe(true);
  });

  it('never runs backwards', () => {
    expect(canTransition(UI_SCAN_TRANSITIONS, 'SCANNING_DOM', 'NAVIGATING')).toBe(false);
    expect(() =>
      assertTransition(UI_SCAN_TRANSITIONS, 'ui scan', 'SCANNING_DOM', 'QUEUED'),
    ).toThrow(ConflictAppException);
  });

  it('allows signing in after the requested page has been scanned', () => {
    // The scan opens the target URL first — often the login page — scans it,
    // and only then signs in, so those controls are part of the result.
    expect(canTransition(UI_SCAN_TRANSITIONS, 'SCANNING_DOM', 'AUTHENTICATING')).toBe(
      true,
    );
    expect(
      canTransition(UI_SCAN_TRANSITIONS, 'VALIDATING_LOCATORS', 'AUTHENTICATING'),
    ).toBe(true);
    // …and scanning resumes afterwards.
    expect(canTransition(UI_SCAN_TRANSITIONS, 'AUTHENTICATING', 'SCANNING_DOM')).toBe(
      true,
    );
    // A finished scan still never re-authenticates.
    expect(canTransition(UI_SCAN_TRANSITIONS, 'COMPLETED', 'AUTHENTICATING')).toBe(
      false,
    );
  });

  it('can end from any running stage', () => {
    for (const stage of ['QUEUED', 'NAVIGATING', 'VALIDATING_LOCATORS'] as const) {
      expect(canTransition(UI_SCAN_TRANSITIONS, stage, 'COMPLETED')).toBe(true);
      expect(canTransition(UI_SCAN_TRANSITIONS, stage, 'CANCELLED')).toBe(true);
      expect(canTransition(UI_SCAN_TRANSITIONS, stage, 'FAILED')).toBe(true);
    }
  });

  it('treats the three end states as terminal', () => {
    expect(isTerminalUiScanStage('COMPLETED')).toBe(true);
    expect(isTerminalUiScanStage('CANCELLED')).toBe(true);
    expect(isTerminalUiScanStage('FAILED')).toBe(true);
    expect(isTerminalUiScanStage('SCANNING_DOM')).toBe(false);
    expect(canTransition(UI_SCAN_TRANSITIONS, 'COMPLETED', 'SCANNING_DOM')).toBe(false);
  });
});
