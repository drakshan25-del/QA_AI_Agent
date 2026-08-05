/**
 * Whether a generated suite may be executed (FR-UIS-025 §5).
 *
 * Locator coverage is *reported*, never enforced. A user's approval of a
 * locator is final, so a warning — a step with no approved match, incomplete
 * locator metadata, or a legacy `review_required` value left in old data —
 * never disables Run. Only conditions that make execution genuinely
 * impossible do.
 */
import type { GeneratedArtifact } from '../../services/api/types';

/** Validation states that still permit execution. */
const RUNNABLE_VALIDATION = new Set([
  'passed',
  'passed_with_warnings',
  'overridden',
]);

export interface ExecutionGateInput {
  artifact: Pick<
    GeneratedArtifact,
    'content' | 'status' | 'approvalStatus' | 'validationStatus'
  > | null;
  /** A generation job is producing this file right now. */
  generating?: boolean;
  /** An execution is already in flight for this project. */
  executing?: boolean;
}

export interface ExecutionGate {
  enabled: boolean;
  /** Why Run is unavailable; empty when it is available. */
  reason: string;
}

export function executionGate({
  artifact,
  generating = false,
  executing = false,
}: ExecutionGateInput): ExecutionGate {
  if (!artifact) {
    return { enabled: false, reason: 'No automation script exists yet.' };
  }
  if (!artifact.content?.trim()) {
    return { enabled: false, reason: 'The automation script is empty.' };
  }
  if (generating) {
    return { enabled: false, reason: 'Script generation is still running.' };
  }
  if (executing) {
    return { enabled: false, reason: 'An execution is already running.' };
  }
  if (artifact.status !== 'active') {
    return {
      enabled: false,
      reason: `This version is ${artifact.status} and cannot be executed.`,
    };
  }
  if (artifact.approvalStatus !== 'approved') {
    return {
      enabled: false,
      reason: 'Automation must be approved before execution (FR-AUT-010).',
    };
  }
  if (!RUNNABLE_VALIDATION.has(artifact.validationStatus)) {
    // A failed or unrun validation is a genuine blocker; a *warning* is not,
    // which is why `passed_with_warnings` is in the runnable set.
    return {
      enabled: false,
      reason: `Validation is ${artifact.validationStatus.replace(/_/g, ' ')}; run validation before executing.`,
    };
  }
  return { enabled: true, reason: '' };
}
