/**
 * Scan metrics summary (FR-UIS-029).
 *
 * These are the numbers the dissertation evaluation reports: how many elements
 * were found, how many got a unique locator, how the locator strategies split
 * between semantic, test-id, CSS and XPath, how often the model was needed, and
 * how long the scan took.
 */
import { Card } from '../../components/ui/Card';
import type { ProjectLocatorMetrics, UiScan } from '../../services/api/types';
import L from '../../styles/layout.module.css';

function percent(value: unknown): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function seconds(ms: unknown): string {
  return typeof ms === 'number' && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '—';
}

export function ScanMetricsPanel({
  scan,
  projectMetrics,
}: {
  scan: UiScan | null;
  projectMetrics?: ProjectLocatorMetrics;
}): JSX.Element | null {
  if (!scan) return null;
  const metrics = (scan.metrics ?? {}) as Record<string, unknown>;

  const tiles: { label: string; value: string }[] = [
    { label: 'Scanned elements', value: String(scan.totalElements) },
    { label: 'Unique locators', value: String(scan.validLocatorCount) },
    { label: 'Needs review', value: String(scan.unresolvedCount) },
    { label: 'Approved', value: String(scan.approvedLocatorCount) },
    { label: 'Semantic locator rate', value: percent(metrics.semanticLocatorRate) },
    { label: 'Test-ID locator rate', value: percent(metrics.testIdLocatorRate) },
    { label: 'CSS fallback rate', value: percent(metrics.cssFallbackRate) },
    { label: 'XPath fallback rate', value: percent(metrics.xpathFallbackRate) },
    { label: 'LLM fallback rate', value: percent(metrics.llmFallbackRate) },
    {
      label: 'Average confidence',
      value:
        typeof metrics.averageConfidence === 'number'
          ? metrics.averageConfidence.toFixed(2)
          : '—',
    },
    {
      label: 'Candidates per element',
      value:
        typeof metrics.averageCandidatesPerElement === 'number'
          ? metrics.averageCandidatesPerElement.toFixed(1)
          : '—',
    },
    { label: 'Scan duration', value: seconds(scan.durationMs) },
    { label: 'Locator validation', value: seconds(metrics.validationDurationMs) },
    { label: 'Pages scanned', value: String(scan.pageCount) },
    { label: 'Frames scanned', value: String(scan.frameCount) },
  ];

  return (
    <Card
      title="Scan metrics"
      subtitle={
        scan.selectedModel
          ? `Model available for unresolved elements: ${scan.selectedModel}`
          : 'Fully deterministic — no model was configured for this project'
      }
    >
      <div className={L.statTiles}>
        {tiles.map((tile) => (
          <div key={tile.label} className={L.stat}>
            <div className={L.statValue}>{tile.value}</div>
            <div className={L.statLabel}>{tile.label}</div>
          </div>
        ))}
      </div>

      {projectMetrics && projectMetrics.scans > 1 && (
        <div style={{ marginTop: 16 }}>
          <div className={L.muted} style={{ fontWeight: 600, marginBottom: 6 }}>
            Across {projectMetrics.scans} completed scans in this project
          </div>
          <dl className={L.kv}>
            <dt>Elements scanned</dt>
            <dd>{projectMetrics.totalElements}</dd>
            <dt>Unique-locator rate</dt>
            <dd>{percent(projectMetrics.uniqueLocatorRate)}</dd>
            <dt>Semantic-locator rate</dt>
            <dd>{percent(projectMetrics.semanticLocatorRate)}</dd>
            <dt>LLM fallback rate</dt>
            <dd>{percent(projectMetrics.llmFallbackRate)}</dd>
            <dt>Approved locators in the library</dt>
            <dd>{projectMetrics.approvedLocators}</dd>
            <dt>Locator approval rate</dt>
            <dd>{percent(projectMetrics.locatorApprovalRate)}</dd>
            <dt>Average scan duration</dt>
            <dd>{seconds(projectMetrics.averageScanDurationMs)}</dd>
          </dl>
        </div>
      )}
    </Card>
  );
}
