import { memo, useState } from 'react';
import type { TimelineState, TimelineStep } from './executionTimeline';
import { plainLabel } from './stepLabels';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { safeHref, toDisplayString } from '../../lib/sanitize';
import { formatDuration } from '../../lib/format';
import s from './execution.module.css';
import L from '../../styles/layout.module.css';

const markerClass: Record<string, string> = {
  running: s.m_running,
  passed: s.m_passed,
  failed: s.m_failed,
  skipped: s.m_skipped,
};
const markerGlyph: Record<string, string> = {
  running: '…',
  passed: '✓',
  failed: '✗',
  skipped: '–',
};

// Memoised: on the live page every incoming event re-renders the timeline;
// existing rows have stable `step` object identities (the reducer only
// appends/replaces), so memo() limits reconciliation to the changed row.
const StepRow = memo(function StepRow({ step }: { step: TimelineStep }): JSX.Element {
  const [open, setOpen] = useState(false);
  // valueSummary is already redacted by the backend (FR-EXE-008); we still label
  // it as masked so reviewers know a secret value is not shown in the clear.
  const hasDetail = Boolean(step.target || step.valueSummary || step.currentUrl || step.evidenceUri);
  return (
    <div className={s.step}>
      <div className={`${s.marker} ${markerClass[step.status] ?? s.m_skipped}`} aria-hidden="true">
        {markerGlyph[step.status] ?? '•'}
      </div>
      <div>
        <div className={s.stepLabel}>{plainLabel(step)}</div>
        {hasDetail && (
          <button className={s.expandBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide technical detail' : 'Show technical detail'}
          </button>
        )}
        {open && (
          <div className={s.stepDetail}>
            <div>action: {step.actionType}</div>
            {step.target && <div>target: {step.target}</div>}
            {step.valueSummary && (
              <div>
                value: <span className={s.mask}>{step.valueSummary}</span>{' '}
                <span className={L.muted}>(secrets masked)</span>
              </div>
            )}
            {step.currentUrl && <div>url: {step.currentUrl}</div>}
            {step.evidenceUri && (
              <div>
                evidence:{' '}
                <a href={safeHref(step.evidenceUri)} target="_blank" rel="noreferrer">
                  {step.evidenceUri}
                </a>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={s.stepTime}>
        <StatusBadge status={step.status} />
        <div>{formatDuration(step.elapsedMs)}</div>
      </div>
    </div>
  );
});

export interface TimelineFilter {
  /** Only show steps with this status (running/passed/failed/skipped). */
  status?: string;
  /** Case-insensitive match on test name / target / action (§23.3.2). */
  query?: string;
}

/** Ordered timeline grouped by test with filters (FR-EXE-006, §23.3.2). */
export function Timeline({
  state,
  filter,
}: {
  state: TimelineState;
  filter?: TimelineFilter;
}): JSX.Element {
  if (state.steps.length === 0) {
    return <p className={L.muted}>No steps yet — waiting for the runner to emit events…</p>;
  }
  const q = (filter?.query ?? '').toLowerCase();
  const matches = (step: TimelineStep) => {
    if (filter?.status && step.status !== filter.status) return false;
    if (
      q &&
      ![step.testName, step.target, step.actionType, step.currentUrl]
        .join(' ')
        .toLowerCase()
        .includes(q)
    ) {
      return false;
    }
    return true;
  };
  const groups = new Map<string, TimelineStep[]>();
  for (const id of state.order) groups.set(id, []);
  for (const step of state.steps) {
    if (!matches(step)) continue;
    const arr = groups.get(step.testCaseId) ?? [];
    arr.push(step);
    groups.set(step.testCaseId, arr);
  }
  for (const [id, steps] of groups) {
    if (steps.length === 0) groups.delete(id);
  }
  if (groups.size === 0) {
    return <p className={L.muted}>No steps match the current filters.</p>;
  }

  return (
    <div>
      {[...groups.entries()].map(([testCaseId, steps]) => {
        const name = steps.find((st) => st.testName)?.testName || testCaseId || 'Test';
        const failed = steps.some((st) => st.status === 'failed');
        const running = steps.some((st) => st.status === 'running');
        const groupStatus = failed ? 'failed' : running ? 'running' : 'passed';
        return (
          <div key={testCaseId} className={s.testGroup}>
            <div className={s.testGroupHead}>
              <StatusBadge status={groupStatus} />
              <span>{name}</span>
              <span className={L.muted} style={{ fontWeight: 400 }}>
                {steps.length} step{steps.length === 1 ? '' : 's'}
              </span>
            </div>
            {steps.map((step) => (
              <StepRow key={`${step.seq}`} step={step} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Evidence viewer — screenshots/artefacts from the run (FR-EXE-008). */
export function EvidencePanel({
  evidence,
}: {
  evidence: Record<string, unknown> | null;
}): JSX.Element {
  if (!evidence || Object.keys(evidence).length === 0) {
    return <p className={L.muted}>No evidence captured.</p>;
  }
  const entries = Object.entries(evidence);
  const isImage = (v: string) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(v);
  return (
    <div className={s.evidenceGrid}>
      {entries.map(([key, value]) => {
        const str = typeof value === 'string' ? value : toDisplayString(value);
        return (
          <div key={key} className={s.evidenceItem}>
            <div className={L.muted} style={{ fontSize: 12, marginBottom: 4 }}>
              {key}
            </div>
            {typeof value === 'string' && isImage(value) ? (
              <a href={safeHref(value)} target="_blank" rel="noreferrer">
                <img src={safeHref(value)} alt={key} />
              </a>
            ) : typeof value === 'string' && /^https?:/i.test(value) ? (
              <a href={safeHref(value)} target="_blank" rel="noreferrer">
                {value}
              </a>
            ) : (
              <div className={L.mono} style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {str}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
