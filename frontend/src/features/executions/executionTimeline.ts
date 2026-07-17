/**
 * Pure reducer for the live execution timeline (FR-EXE-006/007/008/010).
 *
 * Live `execution.step` and `execution.status` envelopes arrive over the WS in
 * `seq` order, but reconnects can replay or duplicate them. This reducer keeps
 * an ordered, de-duplicated view keyed by `seq`, tracks per-test grouping,
 * current URL, elapsed time and overall run status, and is equally driven by
 * the persisted events fetched for replaying a completed run. Keeping it pure
 * makes the exact ordering/dedup behaviour unit-testable without a socket.
 */
import type {
  EventEnvelope,
  ExecutionStatus,
  ExecutionStepPayload,
  StepStatus,
} from '../../services/api/types';

export interface TimelineStep {
  seq: number;
  testCaseId: string;
  testName: string;
  sequence: number;
  actionType: string;
  target: string;
  valueSummary: string;
  status: StepStatus;
  currentUrl: string;
  elapsedMs: number;
  ts: string;
  evidenceUri?: string;
}

export interface TimelineState {
  /** Ordered steps (ascending seq), de-duplicated by seq. */
  steps: TimelineStep[];
  /** Highest seq applied so far (for reconnect resume via lastSeq). */
  lastSeq: number;
  runStatus: ExecutionStatus;
  currentUrl: string;
  currentTestName: string;
  elapsedMs: number;
  /** Steps grouped in first-seen order by testCaseId. */
  order: string[];
}

export const initialTimelineState: TimelineState = {
  steps: [],
  lastSeq: 0,
  runStatus: 'queued',
  currentUrl: '',
  currentTestName: '',
  elapsedMs: 0,
  order: [],
};

export type TimelineAction =
  | { kind: 'event'; envelope: EventEnvelope }
  | { kind: 'reset' }
  | { kind: 'setStatus'; status: ExecutionStatus };

function isStepPayload(p: unknown): p is ExecutionStepPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    'actionType' in p &&
    'sequence' in p
  );
}

const STEP_STATUSES: StepStatus[] = ['running', 'passed', 'failed', 'skipped'];
function coerceStepStatus(s: unknown): StepStatus {
  return STEP_STATUSES.includes(s as StepStatus) ? (s as StepStatus) : 'running';
}

const RUN_STATUSES: ExecutionStatus[] = [
  'queued',
  'running',
  'completed',
  'error',
  'cancelled',
];
function coerceRunStatus(s: unknown, fallback: ExecutionStatus): ExecutionStatus {
  return RUN_STATUSES.includes(s as ExecutionStatus) ? (s as ExecutionStatus) : fallback;
}

function applyStep(state: TimelineState, envelope: EventEnvelope): TimelineState {
  const p = envelope.payload;
  if (!isStepPayload(p)) return state;

  const step: TimelineStep = {
    seq: envelope.seq,
    testCaseId: String(p.testCaseId ?? ''),
    testName: String(p.testName ?? ''),
    sequence: Number(p.sequence ?? 0),
    actionType: String(p.actionType ?? ''),
    target: String(p.target ?? ''),
    valueSummary: String(p.valueSummary ?? ''),
    status: coerceStepStatus(p.status),
    currentUrl: String(p.currentUrl ?? ''),
    elapsedMs: Number(p.elapsedMs ?? 0),
    ts: String(p.ts ?? envelope.ts),
    ...(p.evidenceUri ? { evidenceUri: String(p.evidenceUri) } : {}),
  };

  // De-duplicate by seq; replace if the same seq is re-delivered.
  const existingIdx = state.steps.findIndex((s) => s.seq === step.seq);
  let steps: TimelineStep[];
  if (existingIdx >= 0) {
    steps = state.steps.slice();
    steps[existingIdx] = step;
  } else {
    steps = [...state.steps, step].sort((a, b) => a.seq - b.seq);
  }

  const order = state.order.includes(step.testCaseId)
    ? state.order
    : [...state.order, step.testCaseId];

  return {
    ...state,
    steps,
    order,
    lastSeq: Math.max(state.lastSeq, step.seq),
    currentUrl: step.currentUrl || state.currentUrl,
    currentTestName: step.testName || state.currentTestName,
    elapsedMs: Math.max(state.elapsedMs, step.elapsedMs),
    runStatus: state.runStatus === 'queued' ? 'running' : state.runStatus,
  };
}

function applyStatus(state: TimelineState, envelope: EventEnvelope): TimelineState {
  const status = coerceRunStatus(envelope.payload.status, state.runStatus);
  return {
    ...state,
    runStatus: status,
    lastSeq: Math.max(state.lastSeq, envelope.seq),
  };
}

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.kind) {
    case 'reset':
      return initialTimelineState;
    case 'setStatus':
      return { ...state, runStatus: action.status };
    case 'event': {
      const { envelope } = action;
      // Ignore stale/duplicate status re-broadcasts, but always allow steps
      // (they self-dedupe by seq so replay after reconnect is safe).
      if (envelope.type === 'execution.step') return applyStep(state, envelope);
      if (envelope.type === 'execution.status') return applyStatus(state, envelope);
      return state;
    }
    default:
      return state;
  }
}

/** Build a timeline from persisted events (replay a completed run, FR-EXE-010). */
export function hydrateTimeline(
  envelopes: EventEnvelope[],
  runStatus: ExecutionStatus,
): TimelineState {
  const state = envelopes.reduce(
    (acc, envelope) => timelineReducer(acc, { kind: 'event', envelope }),
    initialTimelineState,
  );
  return { ...state, runStatus };
}
