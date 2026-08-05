/**
 * The Automation Code tab's locator panel (FR-UIS-025 §10).
 *
 * What a reviewer must be able to see for every generated interaction — the
 * element, the page it was scanned on, the strategy, the expression, the
 * source, both confidences, the validation verdict, the version and the last
 * validation date — and what must never appear: anything about the target
 * application's session.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GeneratedArtifact,
  StepLocatorReference,
} from '../../services/api/types';

const api = vi.hoisted(() => ({ locatorReferences: vi.fn() }));
vi.mock('../../services/api/endpoints', () => ({ automationApi: api }));

import { LocatorTraceabilityPanel } from './LocatorTraceabilityPanel';

const REFERENCE: StepLocatorReference = {
  id: 'ref-1',
  projectId: 'project-1',
  testCaseId: 'tc-1',
  testStepId: 'tc-1:step-3',
  stepSequence: 3,
  testStepText: 'Click Login',
  generatedAutomationId: 'run-1',
  generatedFileId: 'artifact-1',
  scannedElementId: 'element-login',
  elementName: 'Login button',
  pageName: 'Login',
  pageUrlPattern: 'https://app.example.com/login',
  locatorId: 'locator-login',
  locatorVersion: 3,
  scanId: 'scan-1',
  strategy: 'role',
  elementMatchConfidence: 0.97,
  locatorConfidence: 0.98,
  validationStatus: 'unique',
  source: 'DETERMINISTIC_SCANNER',
  generatedExpression: 'page.get_by_role("button", name="Login", exact=True)',
  matchRationale: null,
  validatedAt: '2026-08-01T10:00:00.000Z',
  resolvedAt: '2026-08-02T10:00:00.000Z',
  createdAt: '2026-08-02T10:00:00.000Z',
};

function artifact(overrides: Partial<GeneratedArtifact> = {}): GeneratedArtifact {
  return {
    id: 'artifact-1',
    projectId: 'project-1',
    generationRunId: 'run-1',
    testCaseIds: ['tc-1'],
    path: 'automation/generated_tests/test_login.py',
    kind: 'test_file',
    content: '',
    diff: '',
    traceability: {},
    contentHash: 'hash',
    version: 1,
    status: 'active',
    validationStatus: 'passed',
    approvalStatus: 'approved',
    approvalInvalidated: false,
    schemaVersion: 'v1',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  } as GeneratedArtifact;
}

function renderPanel(art: GeneratedArtifact) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LocatorTraceabilityPanel artifact={art} projectId="project-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LocatorTraceabilityPanel', () => {
  beforeEach(() => {
    api.locatorReferences.mockReset();
  });

  it('shows the element, page, strategy, source, confidences, verdict and version', async () => {
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    renderPanel(artifact());

    expect(
      await screen.findByRole('button', { name: 'Login button' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('role')).toBeInTheDocument();
    expect(screen.getByText('UI Scanner')).toBeInTheDocument();
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText('97%')).toBeInTheDocument();
    expect(screen.getByText('Valid and unique')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('reveals the expression, last-validated date and a way into the UI Scanner', async () => {
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    const { container } = renderPanel(artifact());

    await userEvent.click(await screen.findByRole('button', { name: 'Login button' }));

    // The expression is syntax-highlighted into spans, so it is asserted on
    // the rendered text rather than on a single node.
    expect(container.textContent).toContain(
      'page.get_by_role("button", name="Login", exact=True)',
    );
    expect(screen.getByText(/Last validated:/)).toBeInTheDocument();
    expect(screen.getByText(/Test step 3: Click Login/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in UI Scanner' })).toHaveAttribute(
      'href',
      expect.stringContaining('scan=scan-1'),
    );
  });

  it('marks a model-matched step differently from a deterministic one', async () => {
    api.locatorReferences.mockResolvedValue([
      { ...REFERENCE, source: 'LLM_FALLBACK' },
    ]);
    renderPanel(artifact());
    expect(
      await screen.findByText('UI Scanner (model-matched step)'),
    ).toBeInTheDocument();
  });

  it('reports an unmatched step without declaring the file unrunnable', async () => {
    // Approval of a locator is final: a gap in scan coverage is information,
    // never a gate (§2, §5).
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    renderPanel(
      artifact({
        traceability: {
          locatorValidation: 'partial',
          unmatchedSteps: [
            {
              status: 'NO_APPROVED_MATCH',
              testStepId: 'tc-1:step-4',
              testCaseId: 'tc-1',
              sequence: 4,
              testStep: 'Click Confirm Membership',
              action: 'click',
              reason: 'No approved locator matched this test step.',
              suggestedAction: 'Run a targeted UI scan for the Membership page.',
              consideredElements: [],
            },
          ],
        },
      }),
    );

    expect(
      (await screen.findAllByText(/No approved locator matched/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Click Confirm Membership/)).toBeInTheDocument();
    expect(screen.getByText(/the rest still run/)).toBeInTheDocument();
    // The removed workflow must not reappear in any form.
    expect(screen.queryByText(/review required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not execution-ready/i)).not.toBeInTheDocument();
  });

  it('reports Approved when every generated step reused an approved locator', async () => {
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    renderPanel(artifact({ traceability: { locatorValidation: 'approved' } }));
    expect(
      await screen.findByText(/Locator validation: Approved/),
    ).toBeInTheDocument();
  });

  it('reads a legacy artefact without resurrecting the review workflow', async () => {
    // Files generated before the review stage was removed still carry its
    // fields; they must read as a diagnostic, not as a gate (§6).
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    renderPanel(
      artifact({
        traceability: {
          reviewRequired: true,
          unresolvedSteps: [
            {
              status: 'LOCATOR_REVIEW_REQUIRED',
              testStepId: 'tc-1:step-4',
              testCaseId: 'tc-1',
              sequence: 4,
              testStep: 'Click Confirm Membership',
              action: 'click',
              reason: 'No validated scanned locator matches this test step.',
              suggestedAction: 'Run a targeted UI scan for the Membership page.',
              consideredElements: [],
            },
          ],
        },
      }),
    );

    expect(await screen.findByText(/Click Confirm Membership/)).toBeInTheDocument();
    expect(screen.queryByText(/review required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not execution-ready/i)).not.toBeInTheDocument();
  });

  it('never renders anything about the target application session', async () => {
    api.locatorReferences.mockResolvedValue([REFERENCE]);
    const { container } = renderPanel(artifact());
    await screen.findByRole('button', { name: 'Login button' });
    const text = container.textContent ?? '';
    for (const secret of ['password', 'cookie', 'token', 'storageState']) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('renders nothing when the file has no locator-based steps', async () => {
    api.locatorReferences.mockResolvedValue([]);
    const { container } = renderPanel(artifact());
    await waitFor(() => expect(api.locatorReferences).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
