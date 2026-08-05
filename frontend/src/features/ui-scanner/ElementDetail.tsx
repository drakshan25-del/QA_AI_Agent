/**
 * Expanded detail for one scanned element (FR-UIS-018).
 *
 * Shows the element's metadata, its frame and context, and every locator
 * candidate with its verdict and the scoring reasons that produced it — so a
 * reviewer can see *why* one locator was recommended over another rather than
 * being asked to trust a number.
 */
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { LocatorCandidate, ScannedElement } from '../../services/api/types';
import { CopyButton, LocatorCode } from './LocatorCode';
import L from '../../styles/layout.module.css';
import s from './uiScanner.module.css';

function verdictLabel(candidate: LocatorCandidate): {
  status: string;
  label: string;
} {
  if (!candidate.valid) {
    return {
      status: 'failed',
      label: candidate.matchCount === 0 ? 'no match' : 'invalid',
    };
  }
  if (candidate.unique) return { status: 'passed', label: 'unique' };
  return { status: 'pending', label: `${candidate.matchCount} matches` };
}

function stateSummary(states: Record<string, boolean> | null): string {
  if (!states) return '—';
  const on = Object.entries(states)
    .filter(([key, value]) => value && key !== 'hidden')
    .map(([key]) => key);
  return on.length ? on.join(', ') : 'none';
}

export function ElementDetail({
  element,
  onUseCandidate,
  busy,
}: {
  element: ScannedElement;
  onUseCandidate: (candidateId: string) => void;
  busy: boolean;
}): JSX.Element {
  const attributes = (element.attributes ?? {}) as Record<string, unknown>;
  const context = (element.context ?? {}) as Record<string, unknown>;
  const position = element.position ?? {};
  const testIds = (attributes.testIds ?? {}) as Record<string, string>;
  const scopes = (context.scopes ?? []) as { role: string; name: string }[];

  const rows: [string, string][] = [
    ['Element key', element.elementKey],
    ['Tag', element.tagName],
    ['Role', element.role || '—'],
    ['Explicit role', element.explicitRole || '(implicit)'],
    ['Accessible name', element.accessibleName || '—'],
    ['Name derived from', element.accessibleNameSource || '—'],
    ['Input type', String(attributes.inputType || '—')],
    ['Name attribute', String(attributes.name || '—')],
    ['Id', String(attributes.id || '—')],
    ['Placeholder', String(attributes.placeholder || '—')],
    ['Title', String(attributes.title || '—')],
    ['Alt text', String(attributes.alt || '—')],
    ['Href', String(attributes.href || '—')],
    [
      'Value',
      element.sensitive
        ? '(not captured — credential field)'
        : String(attributes.value || '—'),
    ],
    [
      'Test ids',
      Object.entries(testIds)
        .map(([k, v]) => `${k}="${v}"`)
        .join(', ') || '—',
    ],
    ['ARIA label', String(attributes.ariaLabel || '—')],
    ['ARIA described by', String(attributes.ariaDescribedBy || '—')],
    ['States', stateSummary(element.states)],
    [
      'Position',
      position.width != null
        ? `x ${position.x}, y ${position.y} · ${position.width}×${position.height}` +
          (position.inViewport ? ' · in viewport' : ' · outside viewport')
        : '—',
    ],
    ['Associated label', String(context.associatedLabel || '—')],
    ['Nearest heading', String(context.nearestHeading || '—')],
    ['Sibling text', String(context.siblingText || '—')],
    ['Nearby text', String(context.nearbyText || '—')],
    [
      'Containers',
      scopes.map((sc) => `${sc.role} “${sc.name}”`).join(' › ') || '—',
    ],
    [
      'Frame',
      element.frame?.path?.length
        ? `${element.frame.title || element.frame.name || 'iframe'} (${element.frame.path.join(' › ')})`
        : 'main document',
    ],
    ['Page', element.pageUrl || '—'],
  ];

  const candidates = element.candidates ?? [];

  return (
    <div style={{ padding: '10px 4px 14px' }}>
      <div className={s.metaGrid}>
        {rows.map(([key, value]) => (
          <div key={key}>
            <span className={s.metaKey}>{key}: </span>
            <span>{value}</span>
          </div>
        ))}
      </div>

      <div className={L.muted} style={{ fontWeight: 600, margin: '12px 0 6px' }}>
        Locator candidates ({candidates.length})
      </div>

      {candidates.length === 0 ? (
        <p className={L.muted}>
          No locator candidate could be generated for this element. It has no
          accessible name, label, test id or stable attribute to key on.
        </p>
      ) : (
        <ul className={s.candidateList}>
          {candidates.map((candidate) => {
            const verdict = verdictLabel(candidate);
            const recommended = candidate.id === element.recommendedLocatorId;
            return (
              <li key={candidate.id} className={s.candidate}>
                <div className={s.candidateHead}>
                  <strong>{candidate.strategy}</strong>
                  <StatusBadge status={verdict.status} label={verdict.label} />
                  <span className={L.muted} style={{ fontSize: 12 }}>
                    score {candidate.finalScore} · confidence{' '}
                    {candidate.confidence.toFixed(2)}
                  </span>
                  {candidate.source !== 'deterministic-scanner' && (
                    <StatusBadge
                      status="pending"
                      label={
                        candidate.source === 'llm-fallback' ? 'model-proposed' : 'manual'
                      }
                    />
                  )}
                  {recommended && <StatusBadge status="approved" label="recommended" />}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                    <CopyButton value={candidate.expression} label="Copy" />
                    <CopyButton
                      value={candidate.pythonExpression}
                      label="Copy Python"
                    />
                    {!recommended && (
                      <Button
                        small
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onUseCandidate(candidate.id)}
                      >
                        Use this locator
                      </Button>
                    )}
                  </span>
                </div>

                <LocatorCode code={candidate.expression} />

                {candidate.reasons.length > 0 && (
                  <ul className={s.reasonList}>
                    {candidate.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
                {candidate.warnings.length > 0 && (
                  <ul className={s.reasonList} style={{ color: 'var(--warn)' }}>
                    {candidate.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
