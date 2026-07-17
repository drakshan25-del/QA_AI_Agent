import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Banner } from '../../components/ui/Banner';
import type { ApprovalDecision, ApprovalStatus } from '../../services/api/types';
import L from '../../styles/layout.module.css';

/**
 * Human-in-the-loop approval gate controls (FR-HITL-005, FR-TP-005, FR-AUT-010).
 * Emits a decision + optional comment; used by the plan, cases and automation
 * pages. Shows an invalidation warning when an upstream change stale-marked the
 * prior approval (FR-VAL-007).
 */
export function ApprovalControls({
  status,
  invalidated,
  busy,
  onDecide,
  compact,
}: {
  status: ApprovalStatus;
  invalidated?: boolean;
  busy?: boolean;
  onDecide: (decision: ApprovalDecision, comment: string) => void;
  compact?: boolean;
}): JSX.Element {
  const [comment, setComment] = useState('');

  return (
    <div className={L.stack} style={{ gap: 10 }}>
      <div className={L.row}>
        <span className={L.muted}>Approval:</span>
        <StatusBadge status={status} />
        {invalidated && <StatusBadge status="regenerate" label="invalidated by upstream" />}
      </div>
      {invalidated && (
        <Banner kind="warn">
          An upstream change invalidated the previous approval — review and re-approve.
        </Banner>
      )}
      {!compact && (
        <textarea
          aria-label="Approval comment"
          placeholder="Optional comment for the audit trail…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{
            width: '100%',
            minHeight: 60,
            padding: 10,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
      )}
      <div className={L.row}>
        <Button
          variant="primary"
          disabled={busy}
          loading={busy}
          onClick={() => onDecide('approved', comment)}
        >
          Approve
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onDecide('rejected', comment)}>
          Reject
        </Button>
        <Button disabled={busy} onClick={() => onDecide('regenerate', comment)}>
          Request regenerate
        </Button>
      </div>
    </div>
  );
}
