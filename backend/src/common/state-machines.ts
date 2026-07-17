/**
 * Explicit state machines required by the V3 SRS (§23.7 Table 49). The backend
 * validates every status mutation through these maps instead of assigning
 * free-form strings; an invalid transition raises a 409 conflict (FR-BE-005)
 * and is auditable by the caller.
 */
import {
  ApprovalStatus,
  ArtefactState,
  CiRunStatus,
  ExecutionStatus,
  JobStatus,
  ValidationStatus,
} from './enums';
import { ConflictAppException } from './errors';

type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/** Generation job: Queued, Running, Awaiting Approval, Completed, Completed with Warnings, Failed, Cancelled, Timed Out. */
export const JOB_TRANSITIONS: TransitionMap<JobStatus> = {
  queued: ['running', 'cancelled'],
  running: [
    'awaiting_approval',
    'completed',
    'completed_with_warnings',
    'failed',
    'cancelled',
    'timed_out',
  ],
  awaiting_approval: ['completed', 'completed_with_warnings', 'cancelled'],
  completed: [],
  completed_with_warnings: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

/** Execution run: Queued, Preparing, Running, Stopping, Passed, Failed, Partially Passed, Cancelled, Timed Out. */
export const EXECUTION_TRANSITIONS: TransitionMap<ExecutionStatus> = {
  queued: ['preparing', 'running', 'cancelled', 'error', 'failed'],
  preparing: ['running', 'cancelled', 'failed', 'error', 'timed_out'],
  running: [
    'stopping',
    'passed',
    'failed',
    'partially_passed',
    'cancelled',
    'timed_out',
    'completed',
    'error',
  ],
  stopping: ['cancelled', 'failed', 'passed', 'partially_passed'],
  passed: [],
  failed: [],
  partially_passed: [],
  cancelled: [],
  timed_out: [],
  // V2 legacy terminal states (kept readable; no onward transitions).
  completed: [],
  error: [],
};

/** Validation: Not Started, Running, Passed, Passed with Warnings, Failed, Overridden. */
export const VALIDATION_TRANSITIONS: TransitionMap<ValidationStatus> = {
  not_started: ['running'],
  pending: ['running'], // stored V2 alias of not_started
  running: ['passed', 'passed_with_warnings', 'failed'],
  passed: ['running', 'overridden'],
  passed_with_warnings: ['running', 'overridden'],
  failed: ['running', 'overridden'],
  overridden: ['running'],
};

/** CI/CD run: Not Triggered, Queued, In Progress, Successful, Failed, Cancelled. */
export const CI_RUN_TRANSITIONS: TransitionMap<CiRunStatus> = {
  not_triggered: ['queued', 'in_progress'],
  queued: ['in_progress', 'cancelled'],
  in_progress: ['successful', 'failed', 'cancelled'],
  successful: [],
  failed: [],
  cancelled: [],
};

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  if (from === to) return true;
  return (map[from] ?? []).includes(to);
}

/** Validate a transition; throws 409 `invalid_state_transition` when denied. */
export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  entity: string,
  from: S,
  to: S,
): void {
  if (!canTransition(map, from, to)) {
    throw new ConflictAppException(
      `Invalid ${entity} state transition: ${from} → ${to}.`,
      'invalid_state_transition',
      { entity, from, to, allowed: map[from] ?? [] },
    );
  }
}

/** True when the job can no longer progress. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return JOB_TRANSITIONS[status]?.length === 0;
}

/** True when the execution run can no longer progress. */
export function isTerminalExecutionStatus(status: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[status]?.length === 0;
}

/**
 * Derive the §23.7 artefact lifecycle state (Draft, Under Review, Approved,
 * Rejected, Superseded, Archived) from the persisted V2 columns, so existing
 * rows need no data migration.
 */
export function deriveArtefactState(entity: {
  approvalStatus: ApprovalStatus;
  approvalInvalidated?: boolean;
  status?: string;
  archived?: boolean;
}): ArtefactState {
  if (entity.archived) return 'archived';
  if (entity.status === 'superseded') return 'superseded';
  if (entity.approvalStatus === 'approved' && !entity.approvalInvalidated) {
    return 'approved';
  }
  if (entity.approvalStatus === 'rejected') return 'rejected';
  if (entity.approvalInvalidated) return 'under_review';
  return entity.approvalStatus === 'pending' ? 'under_review' : 'draft';
}

/**
 * Final execution status from run metrics (FR-V3-RPT-001 reconciliation):
 * all passed → passed; all failed → failed; a mix → partially_passed.
 */
export function outcomeFromMetrics(metrics: {
  passed?: number;
  failed?: number;
  errors?: number;
  total?: number;
}): Extract<ExecutionStatus, 'passed' | 'failed' | 'partially_passed'> {
  const passed = metrics.passed ?? 0;
  const failed = (metrics.failed ?? 0) + (metrics.errors ?? 0);
  if (failed === 0) return 'passed';
  if (passed === 0) return 'failed';
  return 'partially_passed';
}
