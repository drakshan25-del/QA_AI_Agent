/**
 * UI Scanner frontend tests (FR-UIS-002..020).
 *
 * The API layer and the socket hook are mocked, so these assert what the user
 * sees and does: the form and its validation, the live progress and log
 * console, the results table and its actions, the export helpers and the empty,
 * loading and error states.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LocatorCandidate,
  ScannedElement,
  UiScan,
} from '../../services/api/types';

const api = vi.hoisted(() => ({
  start: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  rescan: vi.fn(),
  logs: vi.fn(),
  elements: vi.fn(),
  metrics: vi.fn(),
  storageStates: vi.fn(),
  approveElement: vi.fn(),
  approveHighConfidence: vi.fn(),
  saveLocators: vi.fn(),
  validateElement: vi.fn(),
  updateLocator: vi.fn(),
  screenshotUrl: vi.fn(() => '/screenshot'),
  accessibilityUrl: vi.fn(() => '/aria'),
  accessibilitySnapshot: vi.fn(),
}));

vi.mock('../../services/api/endpoints', () => ({ uiScannerApi: api }));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({ status: 'connected' }),
}));

const { UiScannerPanel } = await import('./UiScannerPanel');
const { ScanResultsTable } = await import('./ScanResultsTable');
const { UiScanLogConsole } = await import('./UiScanLogConsole');
const { toJson, toPython, toTypeScript } = await import('./exporters');

function candidate(overrides: Partial<LocatorCandidate> = {}): LocatorCandidate {
  return {
    id: 'c1',
    strategy: 'role',
    expression: "page.getByRole('button', { name: 'Save', exact: true })",
    pythonExpression: 'page.get_by_role("button", name="Save", exact=True)',
    locatorData: { strategy: 'role', role: 'button', name: 'Save', exact: true },
    baseScore: 100,
    finalScore: 145,
    confidence: 0.96,
    matchCount: 1,
    unique: true,
    valid: true,
    reasons: ['Accessibility role with the accessible name'],
    warnings: [],
    source: 'deterministic-scanner',
    ...overrides,
  };
}

function element(overrides: Partial<ScannedElement> = {}): ScannedElement {
  return {
    id: 'el-1',
    scanId: 'scan-1',
    projectId: 'project-1',
    elementKey: 'f0:button:button:save',
    tagName: 'button',
    role: 'button',
    explicitRole: '',
    accessibleName: 'Save',
    accessibleNameSource: 'content',
    visibleText: 'Save',
    attributes: { id: '', name: '', testIds: {} },
    states: { visible: true, enabled: true },
    position: { x: 4, y: 8, width: 60, height: 30 },
    context: { associatedLabel: '', scopes: [] },
    frame: null,
    candidates: [candidate()],
    recommendedLocatorId: 'c1',
    status: 'unique',
    sensitive: false,
    pageUrl: 'https://example.com/app',
    pageTitle: 'App',
    createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

function scan(overrides: Partial<UiScan> = {}): UiScan {
  return {
    id: 'scan-1',
    projectId: 'project-1',
    createdBy: 'user-1',
    url: 'https://example.com/app',
    finalUrl: 'https://example.com/app',
    pageTitle: 'App',
    browser: 'chromium',
    headless: true,
    status: 'COMPLETED',
    progress: 100,
    options: {},
    cancelRequested: false,
    totalElements: 1,
    validLocatorCount: 1,
    unresolvedCount: 0,
    frameCount: 1,
    pageCount: 1,
    warningCount: 0,
    errorCount: 0,
    approvedLocatorCount: 0,
    metrics: { semanticLocatorRate: 0.9, averageConfidence: 0.94 },
    frames: [],
    warnings: [],
    errorMessage: '',
    errorDetail: null,
    screenshotFile: '',
    accessibilitySnapshotFile: '',
    selectedModel: 'qwen2.5:latest',
    authenticated: false,
    correlationId: '',
    rescanOfId: null,
    schemaVersion: 'v1',
    startedAt: '2026-08-04T10:00:00.000Z',
    completedAt: '2026-08-04T10:00:08.400Z',
    durationMs: 8400,
    createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T10:00:08.400Z',
    ...overrides,
  };
}

function renderPanel(project?: { baseUrl?: string; llmModel?: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UiScannerPanel
        projectId="project-1"
        project={
          project
            ? ({
                id: 'project-1',
                baseUrl: project.baseUrl ?? '',
                llmModel: project.llmModel ?? '',
              } as never)
            : undefined
        }
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  api.logs.mockResolvedValue([]);
  api.elements.mockResolvedValue([]);
  api.metrics.mockResolvedValue({ scans: 0 });
  api.storageStates.mockResolvedValue([]);
  api.get.mockResolvedValue(scan());
});

describe('UI Scanner tab', () => {
  it('renders the scan configuration form', async () => {
    renderPanel();
    expect(await screen.findByLabelText('Target URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Browser')).toBeInTheDocument();
    expect(screen.getByLabelText('Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Scan timeout (seconds)')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum elements')).toBeInTheDocument();
    expect(screen.getByLabelText('Pages to scan')).toBeInTheDocument();
    expect(screen.getByLabelText('Include hidden elements')).toBeInTheDocument();
    expect(screen.getByLabelText('Include page screenshot')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Include accessibility snapshot'),
    ).toBeInTheDocument();
  });

  it('shows an empty state until a scan exists', async () => {
    renderPanel();
    expect(await screen.findByText('No UI scan yet')).toBeInTheDocument();
  });

  it('defaults the URL to the project base URL', async () => {
    renderPanel({ baseUrl: 'https://staging.example.com' });
    await waitFor(() =>
      expect(screen.getByLabelText('Target URL')).toHaveValue(
        'https://staging.example.com',
      ),
    );
  });

  it('refuses to start without an absolute URL', async () => {
    const user = userEvent.setup();
    renderPanel();
    const url = await screen.findByLabelText('Target URL');
    await user.type(url, 'example.com');
    expect(await screen.findByText(/absolute URL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start scan' })).toBeDisabled();
  });

  it('prompts for credentials and starts an authenticated scan', async () => {
    const user = userEvent.setup();
    api.start.mockResolvedValue({ id: 'scan-1', status: 'QUEUED', url: 'x' });
    renderPanel({ baseUrl: 'https://example.com/app' });

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Username or email'),
      'qa@example.com',
    );
    await user.type(within(dialog).getByLabelText('Password'), 'hunter2');
    await user.click(within(dialog).getByRole('button', { name: 'Sign in and scan' }));

    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start.mock.calls[0][1]).toMatchObject({
      url: 'https://example.com/app',
      username: 'qa@example.com',
      password: 'hunter2',
      browser: 'chromium',
      headless: true,
      // Crawling is opt-in: the default scans only the target page.
      maxPages: 1,
    });
  });

  it('can scan without signing in', async () => {
    const user = userEvent.setup();
    api.start.mockResolvedValue({ id: 'scan-1', status: 'QUEUED', url: 'x' });
    renderPanel({ baseUrl: 'https://example.com/app' });

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    await user.click(
      await screen.findByRole('button', { name: 'Scan without signing in' }),
    );

    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start.mock.calls[0][1].username).toBeUndefined();
    expect(api.start.mock.calls[0][1].password).toBeUndefined();
  });

  it('tells the user credentials are not stored', async () => {
    const user = userEvent.setup();
    renderPanel({ baseUrl: 'https://example.com/app' });
    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    expect(
      await screen.findByText(/never written to the\s+database/i),
    ).toBeInTheDocument();
  });

  it('surfaces a start failure without losing the form', async () => {
    const user = userEvent.setup();
    api.start.mockRejectedValue(new Error('The scanner is already running 2 scan(s)'));
    renderPanel({ baseUrl: 'https://example.com/app' });

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    await user.click(
      await screen.findByRole('button', { name: 'Scan without signing in' }),
    );

    expect(
      await screen.findByText(/already running 2 scan/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Target URL')).toHaveValue('https://example.com/app');
  });

  it('shows progress, counters and a stop control while a scan runs', async () => {
    api.list.mockResolvedValue([scan({ status: 'SCANNING_DOM', progress: 35 })]);
    api.get.mockResolvedValue(
      scan({ status: 'SCANNING_DOM', progress: 35, totalElements: 12 }),
    );
    renderPanel();

    expect(await screen.findByText('Scanning DOM')).toBeInTheDocument();
    expect(screen.getByText('Elements found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop scan' })).toBeInTheDocument();
  });

  it('reports a failed scan with its error code', async () => {
    api.list.mockResolvedValue([scan({ status: 'FAILED' })]);
    api.get.mockResolvedValue(
      scan({
        status: 'FAILED',
        errorMessage: 'The page did not load within the configured timeout.',
        errorDetail: {
          code: 'UI_SCAN_NAVIGATION_TIMEOUT',
          message: 'The page did not load within the configured timeout.',
          scanId: 'scan-1',
          stage: 'NAVIGATING',
          recoverable: true,
        },
      }),
    );
    renderPanel();
    expect(await screen.findByText('UI_SCAN_NAVIGATION_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText(/did not load within/)).toBeInTheDocument();
  });

  it('offers bulk approval and saving once a scan has finished', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue([scan()]);
    api.elements.mockResolvedValue([element()]);
    api.approveHighConfidence.mockResolvedValue({
      approved: 1,
      skipped: 0,
      minConfidence: 0.9,
    });
    renderPanel();

    await user.click(
      await screen.findByRole('button', { name: /Bulk approve high confidence/ }),
    );
    await waitFor(() =>
      expect(api.approveHighConfidence).toHaveBeenCalledWith('project-1', 'scan-1', {
        minConfidence: 0.9,
        uniqueOnly: true,
      }),
    );
    expect(await screen.findByText(/Approved 1 locator/)).toBeInTheDocument();
  });

  it('saves approved locators to the project library', async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue([scan()]);
    api.elements.mockResolvedValue([element({ status: 'approved' })]);
    api.saveLocators.mockResolvedValue({ saved: 1, superseded: 0 });
    renderPanel();

    await user.click(
      await screen.findByRole('button', { name: /Save approved locators/ }),
    );
    await waitFor(() => expect(api.saveLocators).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/1 locator\(s\) saved/)).toBeInTheDocument();
  });
});

describe('scan results table', () => {
  const actions = {
    approve: vi.fn(),
    test: vi.fn(),
    edit: vi.fn(),
    useCandidate: vi.fn(),
  };

  const renderTable = (elements: ScannedElement[]) =>
    render(
      <ScanResultsTable
        elements={elements}
        actions={actions}
        busyElementId={null}
        selected={new Set()}
        onSelectedChange={() => {}}
      />,
    );

  beforeEach(() => vi.clearAllMocks());

  it('shows an empty state when nothing was scanned', () => {
    renderTable([]);
    expect(screen.getByText('No elements scanned yet')).toBeInTheDocument();
  });

  it('renders one row per element with its locator and verdict', () => {
    renderTable([element()]);
    // The element name is the row's expand toggle.
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
    // The locator is rendered as highlighted code (method name token).
    expect(screen.getByText('.getByRole')).toBeInTheDocument();
    expect(screen.getByText('0.96')).toBeInTheDocument();
    expect(screen.getByText('Unique')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('expands a row to reveal candidates and scoring reasons', async () => {
    const user = userEvent.setup();
    renderTable([element()]);
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(screen.getByText(/Locator candidates \(1\)/)).toBeInTheDocument();
    expect(
      screen.getByText('Accessibility role with the accessible name'),
    ).toBeInTheDocument();
  });

  it('never shows the value of a credential field', async () => {
    const user = userEvent.setup();
    renderTable([
      element({
        id: 'el-pw',
        elementKey: 'f0:input:none:password',
        accessibleName: 'Password',
        sensitive: true,
        attributes: { inputType: 'password', value: '', testIds: {} },
      }),
    ]);
    await user.click(screen.getByRole('button', { name: /Password/ }));
    expect(
      screen.getByText('(not captured — credential field)'),
    ).toBeInTheDocument();
  });

  it('runs the row actions', async () => {
    const user = userEvent.setup();
    renderTable([element()]);
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(actions.test).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(actions.edit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(actions.approve).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('shows which page each element came from', () => {
    renderTable([
      element(),
      element({
        id: 'el-2',
        accessibleName: 'Run report',
        pageUrl: 'https://example.com/app/reports/list',
      }),
    ]);
    expect(screen.getByText('app/reports/list'.split('/').slice(-2).join('/')))
      .toBeInTheDocument();
  });

  it('crawling more than one page is requested explicitly', async () => {
    const user = userEvent.setup();
    api.start.mockResolvedValue({ id: 'scan-1', status: 'QUEUED', url: 'x' });
    renderPanel({ baseUrl: 'https://example.com/app' });
    const pages = await screen.findByLabelText('Pages to scan');
    await user.clear(pages);
    await user.type(pages, '8');
    await user.click(screen.getByRole('button', { name: 'Start scan' }));
    await user.click(
      await screen.findByRole('button', { name: 'Scan without signing in' }),
    );
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start.mock.calls[0][1].maxPages).toBe(8);
  });

  it('filters by search text', async () => {
    const user = userEvent.setup();
    renderTable([element(), element({ id: 'el-2', accessibleName: 'Cancel' })]);
    await user.type(screen.getByLabelText('Search elements'), 'cancel');
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
  });
});

describe('log console', () => {
  const rows = [
    {
      seq: 1,
      level: 'info' as const,
      stage: 'NAVIGATING' as const,
      message: 'Navigating to https://example.com',
      progress: 12,
      ts: '2026-08-04T10:00:01.000Z',
    },
    {
      seq: 2,
      level: 'warning' as const,
      stage: 'VALIDATING_LOCATORS' as const,
      message: 'Login button text locator matched 2 elements',
      progress: 70,
      ts: '2026-08-04T10:00:05.000Z',
    },
  ];

  it('renders levels and stages', () => {
    render(
      <UiScanLogConsole
        rows={rows}
        connection="connected"
        scanId="scan-1"
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/Navigating to/)).toBeInTheDocument();
    expect(screen.getByText('[VALIDATING_LOCATORS]')).toBeInTheDocument();
  });

  it('filters by level', async () => {
    const user = userEvent.setup();
    render(
      <UiScanLogConsole
        rows={rows}
        connection="connected"
        scanId="scan-1"
        onClear={() => {}}
      />,
    );
    // Turning every level except `warning` off leaves only the warning line.
    for (const level of ['info', 'debug', 'error', 'success']) {
      await user.click(screen.getByRole('button', { name: level }));
    }
    expect(screen.queryByText(/Navigating to/)).not.toBeInTheDocument();
    expect(screen.getByText(/matched 2 elements/)).toBeInTheDocument();
  });

  it('searches log text', async () => {
    const user = userEvent.setup();
    render(
      <UiScanLogConsole
        rows={rows}
        connection="connected"
        scanId="scan-1"
        onClear={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Search scan logs'), 'matched');
    expect(screen.queryByText(/Navigating to/)).not.toBeInTheDocument();
  });

  it('can pause and resume auto-scroll', async () => {
    const user = userEvent.setup();
    render(
      <UiScanLogConsole
        rows={rows}
        connection="connected"
        scanId="scan-1"
        onClear={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pause auto-scroll' }));
    expect(
      screen.getByRole('button', { name: 'Resume auto-scroll' }),
    ).toBeInTheDocument();
  });
});

describe('exports', () => {
  it('exports JSON with the recommended locators', () => {
    const parsed = JSON.parse(toJson(scan(), [element()]));
    expect(parsed.scanId).toBe('scan-1');
    expect(parsed.locators).toHaveLength(1);
    expect(parsed.locators[0].expression).toContain('getByRole');
  });

  it('exports a TypeScript module', () => {
    const code = toTypeScript(scan(), [element()]);
    expect(code).toContain("import type { Page } from '@playwright/test'");
    expect(code).toContain('save: (page: Page) =>');
  });

  it('exports a Python page object', () => {
    const code = toPython(scan(), [element()]);
    expect(code).toContain('class ScannedLocators:');
    expect(code).toContain('return self.page.get_by_role("button"');
  });

  it('omits elements that never resolved to a locator', () => {
    const unresolved = element({
      id: 'el-x',
      recommendedLocatorId: '',
      candidates: [],
      status: 'needs_review',
    });
    expect(JSON.parse(toJson(scan(), [unresolved])).locators).toHaveLength(0);
  });
});
