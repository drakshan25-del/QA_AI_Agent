/**
 * The engine/backend report is stored as an open JSON object. The exact key
 * layout can vary by engine version, so these accessors read it defensively and
 * expose a normalised view the report UI can render (FR-REP-004/005).
 */
import type { ExecutionRun } from '../../services/api/types';

export interface NormalisedTest {
  name: string;
  outcome: string;
  durationSeconds?: number;
  errorMessage?: string;
}

export interface NormalisedFinding {
  id?: string;
  classification: string;
  confidence?: number;
  rationale?: string;
  severity?: string;
  testName?: string;
  overridden?: boolean;
}

export interface NormalisedReport {
  status: string;
  environment: string;
  durationSeconds?: number;
  counts: { passed: number; failed: number; skipped: number; total: number };
  coveragePercent?: number;
  tests: NormalisedTest[];
  findings: NormalisedFinding[];
  raw: Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export function normaliseReport(
  report: Record<string, unknown>,
  run?: ExecutionRun,
): NormalisedReport {
  // The stored report may nest the meaningful payload under `data`.
  const data =
    report.data && typeof report.data === 'object'
      ? (report.data as Record<string, unknown>)
      : report;
  const metrics =
    (data.metrics && typeof data.metrics === 'object'
      ? (data.metrics as Record<string, unknown>)
      : (run?.metrics as Record<string, unknown> | undefined)) ?? {};
  const summary =
    data.summary && typeof data.summary === 'object'
      ? (data.summary as Record<string, unknown>)
      : {};

  const testsRaw = arr(data.tests).length ? arr(data.tests) : arr(data.results);
  const tests: NormalisedTest[] = testsRaw.map((t) => ({
    name: str(t.name ?? t.nodeId ?? t.node_id ?? t.testName ?? t.test_name, 'test'),
    outcome: str(t.outcome ?? t.status, 'unknown'),
    durationSeconds: num(t.durationSeconds ?? t.duration_seconds ?? t.duration),
    errorMessage: str(t.errorMessage ?? t.error_message ?? t.error) || undefined,
  }));

  const findingsRaw = arr(data.findings).length ? arr(data.findings) : arr(data.classifications);
  const findings: NormalisedFinding[] = findingsRaw.map((f) => ({
    id: typeof f.id === 'string' ? f.id : undefined,
    classification: str(f.classification ?? f.category, 'inconclusive'),
    confidence: num(f.confidence),
    rationale: str(f.rationale ?? f.reason) || undefined,
    severity: str(f.severity) || undefined,
    testName: str(f.testName ?? f.test_name ?? f.test) || undefined,
    overridden: f.overridden === true,
  }));

  const passed =
    num(summary.passed) ?? num(metrics.passed) ?? tests.filter((t) => t.outcome === 'passed').length;
  const failed =
    num(summary.failed) ?? num(metrics.failed) ?? tests.filter((t) => t.outcome === 'failed').length;
  const skipped =
    num(summary.skipped) ?? num(metrics.skipped) ?? tests.filter((t) => t.outcome === 'skipped').length;
  const total =
    num(summary.total) ?? num(metrics.total) ?? (tests.length || passed + failed + skipped);

  const status =
    str(data.status ?? data.overallStatus ?? summary.status) ||
    (failed > 0 ? 'failed' : total > 0 ? 'passed' : run?.status ?? 'unknown');

  return {
    status,
    environment: str(data.environment ?? run?.environment, run?.environment ?? 'local'),
    durationSeconds: num(summary.durationSeconds ?? metrics.durationSeconds ?? metrics.duration_seconds),
    counts: { passed, failed, skipped, total },
    coveragePercent: num(data.coveragePercent ?? summary.coveragePercent),
    tests,
    findings,
    raw: report,
  };
}
