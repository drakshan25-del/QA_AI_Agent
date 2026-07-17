import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import type { ValidationReport, ValidationFinding } from '../../services/api/types';
import { toDisplayString } from '../../lib/sanitize';
import L from '../../styles/layout.module.css';

function severityTone(sev: string): string {
  const s = sev.toLowerCase();
  if (s === 'error' || s === 'high' || s === 'critical') return 'danger';
  if (s === 'warning' || s === 'warn' || s === 'medium') return 'warn';
  return 'info';
}

/**
 * Renders validation findings grouped by file + rule with severity, location
 * and remediation guidance (FR-VAL-006). Content is escaped text only.
 */
export function ValidationFindings({
  report,
  status,
}: {
  report: ValidationReport | null | undefined;
  status?: string;
}): JSX.Element {
  const findings: ValidationFinding[] = report?.findings ?? [];

  if (!report) {
    return (
      <EmptyState title="Not validated yet">
        Run validation to check this file against the rules and allowed domains.
      </EmptyState>
    );
  }

  if (findings.length === 0) {
    return (
      <div className={L.stack}>
        <div className={L.row}>
          <StatusBadge status={status ?? report.status ?? 'passed'} />
          <span className={L.muted}>No findings — validation clean.</span>
        </div>
        {report.summary && <p>{toDisplayString(report.summary)}</p>}
      </div>
    );
  }

  // Group by file.
  const byFile = new Map<string, ValidationFinding[]>();
  for (const f of findings) {
    const key = f.file ?? f.path ?? 'unknown';
    const arr = byFile.get(key) ?? [];
    arr.push(f);
    byFile.set(key, arr);
  }

  return (
    <div className={L.stack}>
      <div className={L.row}>
        <StatusBadge status={status ?? report.status ?? 'failed'} />
        <span className={L.muted}>{findings.length} finding(s)</span>
      </div>
      {[...byFile.entries()].map(([file, fs]) => (
        <div key={file}>
          <div style={{ fontWeight: 600, marginBottom: 6 }} className={L.mono}>
            {file}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {fs.map((f, i) => (
              <li
                key={i}
                style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
              >
                <div className={L.row}>
                  <StatusBadge status={severityTone(f.severity ?? 'info')} label={f.severity ?? 'info'} />
                  {f.rule && <span className={L.mono}>{f.rule}</span>}
                  {(f.location || f.line != null) && (
                    <span className={L.muted}>
                      {f.location ?? `line ${f.line}`}
                    </span>
                  )}
                </div>
                {f.message && <div style={{ marginTop: 2 }}>{toDisplayString(f.message)}</div>}
                {f.guidance && (
                  <div className={L.muted} style={{ fontSize: 13, marginTop: 2 }}>
                    Guidance: {toDisplayString(f.guidance)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
