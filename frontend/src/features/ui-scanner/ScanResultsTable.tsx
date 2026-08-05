/**
 * Scanned elements and their locators (FR-UIS-018).
 *
 * One row per discovered element with its recommended locator, verdict and
 * confidence; expanding a row reveals every candidate and the scoring reasons
 * behind the recommendation. Rows can be selected for bulk approval, and each
 * row offers copy, test, edit, approve and reject.
 */
import { Fragment, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Select, TextInput } from '../../components/ui/Field';
import type {
  LocatorCandidate,
  LocatorStatus,
  ScannedElement,
} from '../../services/api/types';
import { CopyButton, LocatorCode } from './LocatorCode';
import { ElementDetail } from './ElementDetail';
import { elementDisplayName } from './exporters';
import L from '../../styles/layout.module.css';
import s from './uiScanner.module.css';

const STATUS_TONE: Record<LocatorStatus, string> = {
  unique: 'passed',
  valid: 'completed',
  approved: 'approved',
  multiple_matches: 'pending',
  needs_review: 'pending',
  manually_edited: 'queued',
  invalid: 'failed',
  rejected: 'rejected',
};

const STATUS_LABEL: Record<LocatorStatus, string> = {
  unique: 'Unique',
  valid: 'Valid',
  approved: 'Approved',
  multiple_matches: 'Multiple matches',
  needs_review: 'Needs review',
  manually_edited: 'Manually edited',
  invalid: 'Invalid',
  rejected: 'Rejected',
};

/** Short, readable page identity for the results table. */
function pageLabel(pageUrl: string): string {
  try {
    const { pathname } = new URL(pageUrl);
    const segments = pathname.split('/').filter(Boolean);
    return segments.slice(-2).join('/') || '/';
  } catch {
    return pageUrl || '—';
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return 'var(--ok)';
  if (confidence >= 0.6) return 'var(--warn)';
  return 'var(--danger)';
}

export interface ElementAction {
  approve: (element: ScannedElement, approved: boolean) => void;
  test: (element: ScannedElement) => void;
  edit: (element: ScannedElement) => void;
  useCandidate: (element: ScannedElement, candidateId: string) => void;
}

export function ScanResultsTable({
  elements,
  actions,
  busyElementId,
  selected,
  onSelectedChange,
  onSelectElement,
}: {
  elements: ScannedElement[];
  actions: ElementAction;
  busyElementId: string | null;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Notifies the screenshot viewer which element to highlight. */
  onSelectElement?: (element: ScannedElement | null) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return elements.filter((element) => {
      if (statusFilter !== 'all' && element.status !== statusFilter) return false;
      if (!q) return true;
      return [
        element.elementKey,
        element.accessibleName,
        element.visibleText,
        element.role,
        element.tagName,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [elements, statusFilter, query]);

  const toggleSelection = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((e) => selected.has(e.id));

  if (elements.length === 0) {
    return (
      <EmptyState title="No elements scanned yet">
        Run a scan to discover the buttons, fields, links and containers this
        page offers, with a validated locator for each.
      </EmptyState>
    );
  }

  return (
    <div className={L.stack}>
      <div className={s.controls}>
        <div style={{ minWidth: 200, flex: 1 }}>
          <TextInput
            label="Search elements"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, role, text or key…"
          />
        </div>
        <div style={{ minWidth: 180 }}>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All ({elements.length})</option>
            {(Object.keys(STATUS_LABEL) as LocatorStatus[]).map((status) => {
              const count = elements.filter((e) => e.status === status).length;
              return count ? (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]} ({count})
                </option>
              ) : null;
            })}
          </Select>
        </div>
      </div>

      <div className={s.tableScroll}>
        <table className={s.resultsTable}>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="Select all visible elements"
                  checked={allVisibleSelected}
                  onChange={() => {
                    const next = new Set(selected);
                    if (allVisibleSelected) filtered.forEach((e) => next.delete(e.id));
                    else filtered.forEach((e) => next.add(e.id));
                    onSelectedChange(next);
                  }}
                />
              </th>
              <th scope="col">Element</th>
              <th scope="col">Type</th>
              <th scope="col">Role</th>
              <th scope="col">Page</th>
              <th scope="col">Frame</th>
              <th scope="col">State</th>
              <th scope="col">Recommended locator</th>
              <th scope="col">Strategy</th>
              <th scope="col">Matches</th>
              <th scope="col">Confidence</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={13} className={L.muted} style={{ padding: 16 }}>
                  No element matches the current filters.
                </td>
              </tr>
            )}
            {filtered.map((element) => {
              const best: LocatorCandidate | undefined = (
                element.candidates ?? []
              ).find((c) => c.id === element.recommendedLocatorId);
              const isExpanded = expanded === element.id;
              const busy = busyElementId === element.id;
              const states = element.states ?? {};
              return (
                <Fragment key={element.id}>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${elementDisplayName(element)}`}
                        checked={selected.has(element.id)}
                        onChange={() => toggleSelection(element.id)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`${s.rowButton} ${s.elementName}`}
                        aria-expanded={isExpanded}
                        onClick={() => {
                          const next = isExpanded ? null : element.id;
                          setExpanded(next);
                          onSelectElement?.(next ? element : null);
                        }}
                      >
                        {isExpanded ? '▾ ' : '▸ '}
                        {elementDisplayName(element)}
                      </button>
                      <div className={s.elementSub}>{element.elementKey}</div>
                    </td>
                    <td>{element.tagName}</td>
                    <td>{element.role || '—'}</td>
                    <td title={element.pageUrl}>{pageLabel(element.pageUrl)}</td>
                    <td>
                      {element.frame?.path?.length
                        ? element.frame.title || element.frame.name || 'iframe'
                        : 'main'}
                    </td>
                    <td>
                      {states.visible ? 'visible' : 'hidden'}
                      {states.disabled ? ', disabled' : ''}
                      {states.required ? ', required' : ''}
                    </td>
                    <td>
                      {best ? (
                        <LocatorCode code={best.expression} inline />
                      ) : (
                        <span className={L.muted}>No locator generated</span>
                      )}
                    </td>
                    <td>{best?.strategy ?? '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {best ? (best.matchCount < 0 ? '—' : best.matchCount) : '—'}
                    </td>
                    <td>
                      {best ? (
                        <>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {best.confidence.toFixed(2)}
                          </span>
                          <div className={s.confidenceBar}>
                            <div
                              className={s.confidenceFill}
                              style={{
                                width: `${Math.round(best.confidence * 100)}%`,
                                background: confidenceColor(best.confidence),
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        status={STATUS_TONE[element.status] ?? 'idle'}
                        label={STATUS_LABEL[element.status] ?? element.status}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {best && <CopyButton value={best.expression} label="Copy" />}
                        <Button
                          small
                          variant="ghost"
                          disabled={busy || !best}
                          onClick={() => actions.test(element)}
                          title="Re-run this locator against the live page"
                        >
                          Test
                        </Button>
                        <Button
                          small
                          variant="ghost"
                          disabled={busy}
                          onClick={() => actions.edit(element)}
                        >
                          Edit
                        </Button>
                        {element.status === 'approved' ? (
                          <Button
                            small
                            variant="ghost"
                            disabled={busy}
                            onClick={() => actions.approve(element, false)}
                          >
                            Reject
                          </Button>
                        ) : (
                          <Button
                            small
                            disabled={busy || !best}
                            onClick={() => actions.approve(element, true)}
                          >
                            Approve
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={13} className={s.detailCell}>
                        <ElementDetail
                          element={element}
                          busy={busy}
                          onUseCandidate={(candidateId) =>
                            actions.useCandidate(element, candidateId)
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
