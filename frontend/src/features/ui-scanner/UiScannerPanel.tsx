/**
 * UI Scanner section of the Analysis page (FR-UIS-002..020).
 *
 * Configure a scan, sign in to the target application, watch the real backend
 * stages and logs stream in, then review, edit, approve and save the locators
 * the scan produced. Approved locators become the locator library the
 * automation generator draws from (FR-UIS-025).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, ErrorBanner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select, TextInput } from '../../components/ui/Field';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { uiScannerApi } from '../../services/api/endpoints';
import { qk } from '../../services/api/queryKeys';
import { UI_SCAN_TERMINAL_STAGES } from '../../services/api/types';
import type {
  BrowserEngine,
  LocatorData,
  ProjectWithSummary,
  ScannedElement,
  StartUiScanInput,
  UiScan,
} from '../../services/api/types';
import { formatRelative } from '../../lib/format';
import { ScanCredentialsModal, type ScanCredentials } from './ScanCredentialsModal';
import { ScanProgressPanel } from './ScanProgressPanel';
import { ScanResultsTable } from './ScanResultsTable';
import { ScanMetricsPanel } from './ScanMetricsPanel';
import { AccessibilitySnapshotViewer, ScanScreenshot } from './ScanArtifacts';
import { LocatorEditModal } from './LocatorEditModal';
import { UiScanLogConsole } from './UiScanLogConsole';
import { useUiScanStream } from './useUiScanStream';
import {
  downloadText,
  toJson,
  toPython,
  toReport,
  toTypeScript,
} from './exporters';
import L from '../../styles/layout.module.css';
import s from './uiScanner.module.css';

/** Parse an edited numeric field, falling back when it is empty or invalid. */
function numberOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

const BROWSERS: { value: BrowserEngine; label: string }[] = [
  { value: 'chromium', label: 'Chrome (Chromium)' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'Safari (WebKit)' },
];

interface ScanForm {
  url: string;
  browser: BrowserEngine;
  headless: boolean;
  /**
   * Numeric fields are held as strings while the user edits them. Coercing on
   * every keystroke makes the field impossible to clear — it snaps back to the
   * default, so typing "8" over "1" produces "18". They are parsed and clamped
   * when the scan is submitted instead.
   */
  timeoutSeconds: string;
  maxElements: string;
  maxPages: string;
  includeHidden: boolean;
  captureScreenshot: boolean;
  captureAccessibility: boolean;
  scanFrames: boolean;
  useLlmFallback: boolean;
}

export function UiScannerPanel({
  projectId,
  project,
}: {
  projectId: string;
  project?: ProjectWithSummary;
}): JSX.Element {
  const qc = useQueryClient();
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [editing, setEditing] = useState<ScannedElement | null>(null);
  const [highlighted, setHighlighted] = useState<ScannedElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busyElementId, setBusyElementId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // Project configuration supplies the defaults, so a scan usually needs no
  // input beyond pressing the button.
  const [form, setForm] = useState<ScanForm>({
    url: '',
    browser: 'chromium',
    headless: true,
    timeoutSeconds: '45',
    maxElements: '250',
    maxPages: '1',
    includeHidden: false,
    captureScreenshot: true,
    captureAccessibility: true,
    scanFrames: true,
    useLlmFallback: true,
  });
  const [urlTouched, setUrlTouched] = useState(false);

  useEffect(() => {
    if (!urlTouched && project?.baseUrl) {
      setForm((prev) => ({ ...prev, url: project.baseUrl }));
    }
  }, [project?.baseUrl, urlTouched]);

  const scansQuery = useQuery({
    queryKey: qk.uiScans(projectId),
    queryFn: () => uiScannerApi.list(projectId),
    enabled: !!projectId,
  });

  const scans = scansQuery.data ?? [];
  const currentScanId = activeScanId ?? scans[0]?.id ?? null;

  const scanQuery = useQuery({
    queryKey: qk.uiScan(projectId, currentScanId ?? ''),
    queryFn: () => uiScannerApi.get(projectId, currentScanId!),
    enabled: !!currentScanId,
    // Poll only while the scan is unfinished; the socket carries the detail.
    refetchInterval: (q) =>
      q.state.data && UI_SCAN_TERMINAL_STAGES.includes(q.state.data.status)
        ? false
        : 4000,
  });
  const scan: UiScan | null = scanQuery.data ?? null;
  const running = !!scan && !UI_SCAN_TERMINAL_STAGES.includes(scan.status);

  const elementsQuery = useQuery({
    queryKey: qk.uiScanElements(projectId, currentScanId ?? ''),
    queryFn: () => uiScannerApi.elements(projectId, currentScanId!),
    enabled: !!currentScanId && !!scan && !running,
  });
  const elements = useMemo(() => elementsQuery.data ?? [], [elementsQuery.data]);

  const metricsQuery = useQuery({
    queryKey: qk.uiScanMetrics(projectId),
    queryFn: () => uiScannerApi.metrics(projectId),
    enabled: !!projectId,
  });

  const storageStatesQuery = useQuery({
    queryKey: qk.uiScanStorageStates(projectId),
    queryFn: () => uiScannerApi.storageStates(projectId),
    enabled: !!projectId,
  });

  const { logs, live, connection, clearLogs } = useUiScanStream({
    projectId,
    scanId: currentScanId,
    enabled: !!currentScanId,
    onFinished: () => {
      void qc.invalidateQueries({ queryKey: qk.uiScan(projectId, currentScanId ?? '') });
      void qc.invalidateQueries({
        queryKey: qk.uiScanElements(projectId, currentScanId ?? ''),
      });
      void qc.invalidateQueries({ queryKey: qk.uiScans(projectId) });
      void qc.invalidateQueries({ queryKey: qk.uiScanMetrics(projectId) });
    },
  });

  const refreshElements = () =>
    qc.invalidateQueries({
      queryKey: qk.uiScanElements(projectId, currentScanId ?? ''),
    });

  const startScan = useMutation({
    mutationFn: (input: StartUiScanInput) => uiScannerApi.start(projectId, input),
    onSuccess: (result) => {
      setActiveScanId(result.id);
      setSelected(new Set());
      setNotice('');
      void qc.invalidateQueries({ queryKey: qk.uiScans(projectId) });
    },
  });

  const cancelScan = useMutation({
    mutationFn: () => uiScannerApi.cancel(projectId, currentScanId!),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.uiScan(projectId, currentScanId ?? '') }),
  });

  const approveElement = useMutation({
    mutationFn: ({
      element,
      approved,
    }: {
      element: ScannedElement;
      approved: boolean;
    }) =>
      uiScannerApi.approveElement(projectId, currentScanId!, element.id, { approved }),
    onSettled: () => {
      setBusyElementId(null);
      void refreshElements();
      void qc.invalidateQueries({ queryKey: qk.uiScan(projectId, currentScanId ?? '') });
    },
  });

  const useCandidate = useMutation({
    mutationFn: ({
      element,
      candidateId,
    }: {
      element: ScannedElement;
      candidateId: string;
    }) =>
      uiScannerApi.approveElement(projectId, currentScanId!, element.id, {
        approved: true,
        candidateId,
      }),
    onSettled: () => {
      setBusyElementId(null);
      void refreshElements();
    },
  });

  const testLocator = useMutation({
    mutationFn: (element: ScannedElement) =>
      uiScannerApi.validateElement(projectId, currentScanId!, element.id, {}),
    onSuccess: (updated) => {
      setNotice(
        updated.status === 'unique'
          ? 'Locator re-validated: it matches exactly one element.'
          : `Locator re-validated: status is now "${updated.status.replace(/_/g, ' ')}".`,
      );
    },
    onSettled: () => {
      setBusyElementId(null);
      void refreshElements();
    },
  });

  const saveEdit = useMutation({
    mutationFn: ({
      element,
      locatorData,
    }: {
      element: ScannedElement;
      locatorData: LocatorData;
    }) =>
      uiScannerApi.updateLocator(projectId, currentScanId!, element.id, locatorData),
    onSuccess: () => {
      setEditing(null);
      setNotice('Locator updated. Run “Test” to validate it against the page.');
    },
    onSettled: () => void refreshElements(),
  });

  const bulkApprove = useMutation({
    mutationFn: () =>
      uiScannerApi.approveHighConfidence(projectId, currentScanId!, {
        minConfidence: 0.9,
        uniqueOnly: true,
      }),
    onSuccess: (result) => {
      setNotice(
        `Approved ${result.approved} locator(s) with confidence ≥ ${result.minConfidence} ` +
          `that matched exactly one element; ${result.skipped} left for review.`,
      );
      void refreshElements();
      void qc.invalidateQueries({ queryKey: qk.uiScan(projectId, currentScanId ?? '') });
    },
  });

  const saveLocators = useMutation({
    mutationFn: () =>
      uiScannerApi.saveLocators(projectId, currentScanId!, {
        elementIds: selected.size ? [...selected] : undefined,
        pageName: scan?.pageTitle,
      }),
    onSuccess: (result) => {
      setNotice(
        `${result.saved} locator(s) saved to the project library` +
          (result.superseded
            ? `, superseding ${result.superseded} previous version(s).`
            : '. Automation generation will now use them.'),
      );
      void qc.invalidateQueries({ queryKey: qk.locators(projectId) });
      void qc.invalidateQueries({ queryKey: qk.uiScanMetrics(projectId) });
    },
  });

  const rescan = useMutation({
    mutationFn: () => uiScannerApi.rescan(projectId, currentScanId!, {}),
    onSuccess: (result) => {
      setActiveScanId(result.id);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: qk.uiScans(projectId) });
    },
  });

  const approvedCount = elements.filter((e) => e.status === 'approved').length;

  const buildInput = (credentials?: ScanCredentials): StartUiScanInput => ({
    url: form.url.trim(),
    browser: form.browser,
    headless: form.headless,
    timeoutMs: clamp(numberOr(form.timeoutSeconds, 45), 5, 300) * 1000,
    maxElements: clamp(numberOr(form.maxElements, 250), 1, 1000),
    maxPages: clamp(numberOr(form.maxPages, 1), 1, 25),
    includeHidden: form.includeHidden,
    captureScreenshot: form.captureScreenshot,
    captureAccessibility: form.captureAccessibility,
    scanFrames: form.scanFrames,
    useLlmFallback: form.useLlmFallback,
    loginUrl: credentials?.loginUrl || undefined,
    username: credentials?.username || undefined,
    password: credentials?.password || undefined,
    storageStateId: credentials?.storageStateId || undefined,
  });

  const urlError =
    form.url.trim() && !/^https?:\/\//i.test(form.url.trim())
      ? 'Enter an absolute URL beginning with http:// or https://'
      : '';

  return (
    <div className={L.stack}>
      <Card
        title="UI Scanner"
        subtitle="Open the application in a real browser, discover its test-relevant elements and generate validated Playwright locators"
        actions={
          scan && (
            <StatusBadge
              status={
                scan.status === 'COMPLETED'
                  ? 'completed'
                  : scan.status === 'FAILED'
                    ? 'failed'
                    : scan.status === 'CANCELLED'
                      ? 'cancelled'
                      : 'running'
              }
              label={scan.status.replace(/_/g, ' ')}
            />
          )
        }
      >
        <div className={s.formGrid}>
          <TextInput
            label="Target URL"
            value={form.url}
            error={urlError}
            hint={
              project?.baseUrl
                ? `Project base URL: ${project.baseUrl}`
                : 'The page the scanner should open'
            }
            onChange={(e) => {
              setUrlTouched(true);
              setForm({ ...form, url: e.target.value });
            }}
            placeholder="https://example.com/dashboard"
          />
          <Select
            label="Browser"
            value={form.browser}
            onChange={(e) =>
              setForm({ ...form, browser: e.target.value as BrowserEngine })
            }
          >
            {BROWSERS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
          <Select
            label="Mode"
            hint="Headed opens a visible browser on the engine host"
            value={form.headless ? 'headless' : 'headed'}
            onChange={(e) =>
              setForm({ ...form, headless: e.target.value === 'headless' })
            }
          >
            <option value="headless">Headless</option>
            <option value="headed">Headed</option>
          </Select>
          <TextInput
            label="Scan timeout (seconds)"
            type="number"
            min={5}
            max={300}
            value={form.timeoutSeconds}
            onChange={(e) => setForm({ ...form, timeoutSeconds: e.target.value })}
          />
          <TextInput
            label="Maximum elements"
            type="number"
            min={1}
            max={1000}
            value={form.maxElements}
            onChange={(e) => setForm({ ...form, maxElements: e.target.value })}
          />
          <TextInput
            label="Pages to scan"
            type="number"
            min={1}
            max={25}
            hint={
              numberOr(form.maxPages, 1) > 1
                ? 'Follows in-app links. Sign-out, destructive and off-site links are never followed.'
                : 'Scans only the target page. Increase to crawl the application.'
            }
            value={form.maxPages}
            onChange={(e) => setForm({ ...form, maxPages: e.target.value })}
          />
        </div>

        <div className={s.toggles}>
          <label className={s.toggle}>
            <input
              type="checkbox"
              checked={form.includeHidden}
              onChange={(e) => setForm({ ...form, includeHidden: e.target.checked })}
            />
            Include hidden elements
          </label>
          <label className={s.toggle}>
            <input
              type="checkbox"
              checked={form.scanFrames}
              onChange={(e) => setForm({ ...form, scanFrames: e.target.checked })}
            />
            Scan iframes
          </label>
          <label className={s.toggle}>
            <input
              type="checkbox"
              checked={form.captureScreenshot}
              onChange={(e) =>
                setForm({ ...form, captureScreenshot: e.target.checked })
              }
            />
            Include page screenshot
          </label>
          <label className={s.toggle}>
            <input
              type="checkbox"
              checked={form.captureAccessibility}
              onChange={(e) =>
                setForm({ ...form, captureAccessibility: e.target.checked })
              }
            />
            Include accessibility snapshot
          </label>
          <label
            className={s.toggle}
            title={
              project?.llmModel
                ? `Uses this project's model (${project.llmModel}) only for elements the deterministic scan could not resolve`
                : 'This project has no model configured; the scan stays fully deterministic'
            }
          >
            <input
              type="checkbox"
              checked={form.useLlmFallback}
              disabled={!project?.llmModel}
              onChange={(e) =>
                setForm({ ...form, useLlmFallback: e.target.checked })
              }
            />
            Ask the model about unresolved elements
          </label>
        </div>

        <div className={s.controls}>
          <Button
            variant="primary"
            disabled={!form.url.trim() || !!urlError || running || startScan.isPending}
            loading={startScan.isPending}
            onClick={() => setCredentialsOpen(true)}
          >
            Start scan
          </Button>
          {running && (
            <Button
              variant="danger"
              loading={cancelScan.isPending}
              onClick={() => cancelScan.mutate()}
            >
              Stop scan
            </Button>
          )}
          {scan && !running && (
            <Button
              loading={rescan.isPending}
              onClick={() => rescan.mutate()}
              title="Run the same scan again with the same configuration"
            >
              Rescan
            </Button>
          )}
          {scan && !running && elements.length > 0 && (
            <>
              <Button
                loading={bulkApprove.isPending}
                onClick={() => bulkApprove.mutate()}
                title="Approve every unique locator with confidence 0.90 or higher"
              >
                Bulk approve high confidence
              </Button>
              <Button
                variant="primary"
                disabled={approvedCount === 0 && selected.size === 0}
                loading={saveLocators.isPending}
                onClick={() => {
                  if (
                    scan.approvedLocatorCount > 0 &&
                    !window.confirm(
                      'Saving replaces the previously approved locators for these elements ' +
                        'with new versions. The old versions stay in the history. Continue?',
                    )
                  ) {
                    return;
                  }
                  saveLocators.mutate();
                }}
              >
                Save approved locators
                {selected.size ? ` (${selected.size} selected)` : ''}
              </Button>
            </>
          )}
          {scans.length > 1 && (
            <div style={{ minWidth: 260, marginLeft: 'auto' }}>
              <Select
                label="Scan history"
                value={currentScanId ?? ''}
                onChange={(e) => setActiveScanId(e.target.value)}
              >
                {scans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.status} · {item.url.slice(0, 48)} ·{' '}
                    {formatRelative(item.createdAt)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {startScan.isError && <ErrorBanner error={startScan.error} />}
        {cancelScan.isError && <ErrorBanner error={cancelScan.error} />}
        {saveLocators.isError && <ErrorBanner error={saveLocators.error} />}
        {testLocator.isError && <ErrorBanner error={testLocator.error} />}
        {saveEdit.isError && <ErrorBanner error={saveEdit.error} />}
        {notice && <Banner kind="success">{notice}</Banner>}
        {scan?.status === 'FAILED' && (
          <Banner kind="error" title={scan.errorDetail?.code ?? 'Scan failed'}>
            {scan.errorMessage || 'The scan failed.'}
            {scan.errorDetail?.recoverable && ' You can adjust the settings and try again.'}
          </Banner>
        )}
        {(scan?.warnings?.length ?? 0) > 0 && (
          <Banner kind="warn" title="Scan warnings">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {scan!.warnings!.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}
      </Card>

      {currentScanId && (
        <Card title="Scan progress">
          <ScanProgressPanel scan={scan} live={live} />
        </Card>
      )}

      {currentScanId && (
        <UiScanLogConsole
          rows={logs}
          connection={connection}
          scanId={currentScanId}
          onClear={clearLogs}
        />
      )}

      {scan && !running && (
        <>
          <ScanMetricsPanel scan={scan} projectMetrics={metricsQuery.data} />

          <Card
            title={`Scanned elements (${elements.length})`}
            subtitle={
              elements.length
                ? `${scan.validLocatorCount} unique · ${scan.unresolvedCount} need review · ` +
                  `${approvedCount} approved · across ${scan.pageCount} page(s)`
                : undefined
            }
            actions={
              elements.length > 0 && (
                <div className={s.controls}>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        `ui-scan-${scan.id.slice(0, 8)}.json`,
                        toJson(scan, elements),
                        'application/json',
                      )
                    }
                  >
                    Export JSON
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        `locators-${scan.id.slice(0, 8)}.ts`,
                        toTypeScript(scan, elements),
                        'text/typescript',
                      )
                    }
                  >
                    Export TypeScript
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        `locators_${scan.id.slice(0, 8)}.py`,
                        toPython(scan, elements),
                        'text/x-python',
                      )
                    }
                  >
                    Export Python
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        `ui-scan-report-${scan.id.slice(0, 8)}.txt`,
                        toReport(scan, elements),
                        'text/plain',
                      )
                    }
                  >
                    Download report
                  </Button>
                </div>
              )
            }
          >
            {elementsQuery.isLoading ? (
              <p className={L.muted}>Loading scanned elements…</p>
            ) : (
              <ScanResultsTable
                elements={elements}
                selected={selected}
                onSelectedChange={setSelected}
                onSelectElement={setHighlighted}
                busyElementId={busyElementId}
                actions={{
                  approve: (element, approved) => {
                    setBusyElementId(element.id);
                    approveElement.mutate({ element, approved });
                  },
                  test: (element) => {
                    setBusyElementId(element.id);
                    testLocator.mutate(element);
                  },
                  edit: (element) => setEditing(element),
                  useCandidate: (element, candidateId) => {
                    setBusyElementId(element.id);
                    useCandidate.mutate({ element, candidateId });
                  },
                }}
              />
            )}
          </Card>

          <div className={L.split}>
            <ScanScreenshot
              projectId={projectId}
              scan={scan}
              highlighted={highlighted}
            />
            <AccessibilitySnapshotViewer projectId={projectId} scan={scan} />
          </div>
        </>
      )}

      {!currentScanId && !scansQuery.isLoading && (
        <EmptyState title="No UI scan yet">
          Enter the URL of the application under test and start a scan. The
          scanner opens it in a real browser, finds the elements that matter for
          testing and proposes a validated locator for each one.
        </EmptyState>
      )}

      <ScanCredentialsModal
        open={credentialsOpen}
        targetUrl={form.url}
        storageStates={storageStatesQuery.data ?? []}
        onCancel={() => setCredentialsOpen(false)}
        onSkip={() => {
          setCredentialsOpen(false);
          startScan.mutate(buildInput());
        }}
        onSubmit={(credentials) => {
          setCredentialsOpen(false);
          startScan.mutate(buildInput(credentials));
        }}
      />

      <LocatorEditModal
        open={!!editing}
        element={editing}
        saving={saveEdit.isPending}
        onCancel={() => setEditing(null)}
        onSave={(locatorData) => {
          if (editing) saveEdit.mutate({ element: editing, locatorData });
        }}
      />
    </div>
  );
}
