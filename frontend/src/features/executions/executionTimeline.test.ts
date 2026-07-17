import { describe, expect, it } from 'vitest';
import {
  hydrateTimeline,
  initialTimelineState,
  timelineReducer,
  type TimelineState,
} from './executionTimeline';
import type { EventEnvelope, ExecutionStepPayload } from '../../services/api/types';

function stepEnvelope(
  seq: number,
  overrides: Partial<ExecutionStepPayload> = {},
): EventEnvelope {
  return {
    type: 'execution.step',
    correlationId: 'c1',
    projectId: 'p1',
    runId: 'r1',
    seq,
    ts: `2026-01-01T00:00:0${seq}Z`,
    payload: {
      testCaseId: 'tc1',
      testName: 'Login works',
      sequence: seq,
      actionType: 'click',
      target: '#submit',
      valueSummary: '',
      status: 'passed',
      currentUrl: 'http://localhost:8001/login',
      elapsedMs: seq * 100,
      ts: `2026-01-01T00:00:0${seq}Z`,
      ...overrides,
    },
  };
}

describe('timelineReducer', () => {
  it('appends steps in seq order and tracks lastSeq / current fields', () => {
    let state = initialTimelineState;
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(1) });
    state = timelineReducer(state, {
      kind: 'event',
      envelope: stepEnvelope(2, { actionType: 'assert', currentUrl: 'http://localhost:8001/home' }),
    });

    expect(state.steps).toHaveLength(2);
    expect(state.steps.map((s) => s.seq)).toEqual([1, 2]);
    expect(state.lastSeq).toBe(2);
    expect(state.currentUrl).toBe('http://localhost:8001/home');
    expect(state.currentTestName).toBe('Login works');
    expect(state.runStatus).toBe('running'); // moves off "queued" on first step
  });

  it('sorts out-of-order arrivals by seq', () => {
    let state = initialTimelineState;
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(3) });
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(1) });
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(2) });
    expect(state.steps.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(state.lastSeq).toBe(3);
  });

  it('de-duplicates a replayed seq instead of appending it twice', () => {
    let state = initialTimelineState;
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(1, { status: 'running' }) });
    // Same seq re-delivered after reconnect with an updated status.
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(1, { status: 'passed' }) });
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.status).toBe('passed');
  });

  it('groups distinct testCaseIds in first-seen order', () => {
    let state = initialTimelineState;
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(1, { testCaseId: 'a' }) });
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(2, { testCaseId: 'b' }) });
    state = timelineReducer(state, { kind: 'event', envelope: stepEnvelope(3, { testCaseId: 'a' }) });
    expect(state.order).toEqual(['a', 'b']);
  });

  it('applies execution.status envelopes to runStatus', () => {
    let state: TimelineState = initialTimelineState;
    state = timelineReducer(state, {
      kind: 'event',
      envelope: {
        type: 'execution.status',
        correlationId: 'c1',
        projectId: 'p1',
        runId: 'r1',
        seq: 5,
        ts: '2026-01-01T00:00:05Z',
        payload: { status: 'completed' },
      },
    });
    expect(state.runStatus).toBe('completed');
    expect(state.lastSeq).toBe(5);
  });

  it('coerces unknown step/run statuses to safe defaults', () => {
    let state = initialTimelineState;
    state = timelineReducer(state, {
      kind: 'event',
      envelope: stepEnvelope(1, { status: 'weird' as unknown as ExecutionStepPayload['status'] }),
    });
    expect(state.steps[0]?.status).toBe('running');
  });

  it('resets to the initial state', () => {
    let state = timelineReducer(initialTimelineState, { kind: 'event', envelope: stepEnvelope(1) });
    state = timelineReducer(state, { kind: 'reset' });
    expect(state).toEqual(initialTimelineState);
  });

  it('hydrateTimeline replays persisted events and pins the final run status', () => {
    const state = hydrateTimeline([stepEnvelope(1), stepEnvelope(2)], 'completed');
    expect(state.steps).toHaveLength(2);
    expect(state.runStatus).toBe('completed');
    expect(state.lastSeq).toBe(2);
  });
});
