import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Banner, ErrorBanner } from '../../components/ui/Banner';
import { Select } from '../../components/ui/Field';
import { EvidencePanel } from '../executions/Timeline';
import { normaliseReport, type NormalisedFinding } from './reportModel';
import { executionsApi, findingsApi } from '../../services/api/endpoints';
import { downloadFile } from '../../services/api/download';
import type { ExecutionRun, FindingClassification, ReportCounts } from '../../services/api/types';
import { formatDuration } from '../../lib/format';
import { toDisplayString } from '../../lib/sanitize';
import ui from '../../components/ui/ui.module.css';
import L from '../../styles/layout.module.css';

const CLASSIFICATIONS: FindingClassification[] = [
  'app_defect',
  'test_defect',
  'environment',
  'data',
  'flaky',
  'inconclusive',
  'unknown',
];

function FindingRow({ finding }: { finding: NormalisedFinding }): JSX.Element {
  const qc = useQueryClient();
  const [cls, setCls] = useState<FindingClassification>(
    (CLASSIFICATIONS.includes(finding.classification as FindingClassification)
      ? finding.classification
      : 'inconclusive') as FindingClassification,
  );
  const [reason, setReason] = useState('');
  const override = useMutation({
    mutationFn: () => findingsApi.override(finding.id!, cls, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['executions'] }),
  });

  return (
    <li style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className={L.row}>
        <StatusBadge status={finding.classification} label={finding.classification} />
        {finding.confidence != null && (
          <span className={L.muted}>confidence {(finding.confidence * 100).toFixed(0)}%</span>
        )}
        {finding.severity && <StatusBadge status={finding.severity} label={finding.severity} />}
        {finding.overridden && <StatusBadge status="regenerate" label="overridden" />}
      </div>
      {finding.testName && <div style={{ marginTop: 2 }}>{finding.testName}</div>}
      {finding.rationale && (
        <div className={L.muted} style={{ fontSize: 13, marginTop: 2 }}>
          {finding.rationale}
        </div>
      )}
      {finding.id && (
        <div className={L.row} style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 180 }}>
            <Select
              label="Override classification (FR-RES-005)"
              value={cls}
              onChange={(e) => setCls(e.target.value as FindingClassification)}
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <input
            aria-label="Override reason"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ padding: '7px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', flex: 1, marginBottom: 14 }}
          />
          <div style={{ marginBottom: 14 }}>
            <Button
              small
              loading={override.isPending}
              disabled={!reason.trim() || override.isPending}
              onClick={() => override.mutate()}
            >
              Override
            </Button>
          </div>
        </div>
      )}
      {override.isError && <ErrorBanner error={override.error} />}
    </li>
  );
}

/**
 * Full execution report (FR-REP-004/005/006): overall status, environment,
 * pass/fail/skip counts, duration, per-test detail, failure classifications
 * with confidence/rationale/override, evidence and exports.
 */
export function ReportView({
  runId,
  report,
  run,
}: {
  runId: string;
  report: Record<string, unknown>;
  run?: ExecutionRun;
}): JSX.Element {
  const model = normaliseReport(report, run);
  const [showRaw, setShowRaw] = useState(false);

  // Reconciled V3 counts (FR-V3-RPT-001), falling back to model counts.
  const rawCounts = (report.counts ?? {}) as Partial<ReportCounts>;
  const v3Counts: ReportCounts = {
    total: rawCounts.total ?? model.counts.total,
    passed: rawCounts.passed ?? model.counts.passed,
    failed: rawCounts.failed ?? model.counts.failed,
    skipped: rawCounts.skipped ?? model.counts.skipped,
    blocked: rawCounts.blocked ?? 0,
    flaky: rawCounts.flaky ?? 0,
    notRun: rawCounts.notRun ?? 0,
    passRate:
      rawCounts.passRate ??
      (model.counts.passed + model.counts.failed > 0
        ? Math.round(
            (model.counts.passed / (model.counts.passed + model.counts.failed)) * 100,
          )
        : 0),
  };
  const meta = [
    run?.browser && `browser: ${run.browser}`,
    run && `mode: ${run.headed ? 'headed' : 'headless'} (${run.mode})`,
    `environment: ${model.environment}`,
    run?.ciRunId && `CI run: ${run.ciRunId.slice(0, 8)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={L.stack}>
      <Card
        title="Summary"
        actions={<StatusBadge status={model.status} />}
        subtitle={meta}
      >
        <div className={L.statTiles}>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--ok)' }}>
              {model.counts.passed}
            </div>
            <div className={L.statLabel}>Passed</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--danger)' }}>
              {model.counts.failed}
            </div>
            <div className={L.statLabel}>Failed</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--neutral)' }}>
              {model.counts.skipped}
            </div>
            <div className={L.statLabel}>Skipped</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--warn)' }}>
              {v3Counts.blocked}
            </div>
            <div className={L.statLabel}>Blocked</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--warn)' }}>
              {v3Counts.flaky}
            </div>
            <div className={L.statLabel}>Flaky</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue} style={{ color: 'var(--neutral)' }}>
              {v3Counts.notRun}
            </div>
            <div className={L.statLabel}>Not run</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue}>{model.counts.total}</div>
            <div className={L.statLabel}>Total</div>
          </div>
          <div className={L.stat}>
            <div className={L.statValue}>{v3Counts.passRate}%</div>
            <div className={L.statLabel}>Pass rate</div>
          </div>
          {model.durationSeconds != null && (
            <div className={L.stat}>
              <div className={L.statValue}>{formatDuration(model.durationSeconds * 1000)}</div>
              <div className={L.statLabel}>Duration</div>
            </div>
          )}
          {model.coveragePercent != null && (
            <div className={L.stat}>
              <div className={L.statValue}>{model.coveragePercent}%</div>
              <div className={L.statLabel}>Coverage</div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Export" subtitle="Download the report (FR-REP-005/006)">
        <div className={L.row}>
          {(['pdf', 'html', 'json', 'junit', 'csv'] as const).map((fmt) => (
            <Button
              key={fmt}
              small
              onClick={() =>
                void downloadFile(
                  executionsApi.reportExportUrl(runId, fmt),
                  `report-${runId.slice(0, 8)}.${fmt === 'junit' ? 'xml' : fmt}`,
                )
              }
            >
              {fmt === 'csv' ? 'Excel/CSV' : fmt.toUpperCase()}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="Test details">
        {model.tests.length === 0 ? (
          <p className={L.muted}>No per-test detail in this report.</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {model.tests.map((t, i) => (
                  <tr key={i}>
                    <td>{t.name}</td>
                    <td>
                      <StatusBadge status={t.outcome} />
                    </td>
                    <td>{t.durationSeconds != null ? formatDuration(t.durationSeconds * 1000) : '—'}</td>
                    <td className={L.muted} style={{ maxWidth: 320 }}>
                      {t.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Failure classifications" subtitle="AI classification with override (FR-RES-005)">
        {model.findings.length === 0 ? (
          <p className={L.muted}>No failure classifications for this run.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {model.findings.map((f, i) => (
              <FindingRow key={f.id ?? i} finding={f} />
            ))}
          </ul>
        )}
      </Card>

      {run && (
        <Card title="Evidence">
          <EvidencePanel evidence={run.evidence} />
        </Card>
      )}

      <Card
        title="Raw report"
        actions={
          <Button small variant="ghost" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide' : 'Show'}
          </Button>
        }
      >
        {showRaw ? (
          <pre className={L.mono} style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
            {toDisplayString(model.raw)}
          </pre>
        ) : (
          <Banner kind="info">The complete machine-readable report is available above.</Banner>
        )}
      </Card>
    </div>
  );
}
