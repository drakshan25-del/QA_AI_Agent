import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API surface the AuthContext + RegressionPage depend on.
const refresh = vi.fn();
const me = vi.fn();
const listByProject = vi.fn();
const compare = vi.fn();
const listComparisons = vi.fn();

vi.mock('../services/api/endpoints', () => ({
  authApi: {
    refresh: (...a: unknown[]) => refresh(...a),
    me: (...a: unknown[]) => me(...a),
    login: vi.fn(),
    logout: vi.fn(),
  },
  executionsApi: {
    listByProject: (...a: unknown[]) => listByProject(...a),
  },
  regressionApi: {
    compare: (...a: unknown[]) => compare(...a),
    list: (...a: unknown[]) => listComparisons(...a),
    get: vi.fn(),
    markBaseline: vi.fn(),
  },
}));

import { RegressionPage } from './RegressionPage';
import { AuthProvider } from '../auth/AuthContext';
import { ApiClientError } from '../services/api/client';
import type { ExecutionRun, RegressionComparison } from '../services/api/types';

const runs = [
  {
    id: 'aaaaaaaa-run1',
    projectId: 'p1',
    status: 'passed',
    isBaseline: true,
    startedAt: '2026-08-13T09:00:00.000Z',
    createdAt: '2026-08-13T09:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-run2',
    projectId: 'p1',
    status: 'failed',
    isBaseline: false,
    startedAt: '2026-08-13T10:00:00.000Z',
    createdAt: '2026-08-13T10:00:00.000Z',
  },
] as unknown as ExecutionRun[];

const regressedComparison: RegressionComparison = {
  id: 'cmp-1',
  projectId: 'p1',
  baselineRunId: 'aaaaaaaa-run1',
  candidateRunId: 'bbbbbbbb-run2',
  hasRegressions: true,
  result: {
    regressions: ['tests/test_login.py::test_login_ok'],
    fixes: ['tests/test_login.py::test_reset_password'],
    still_failing: ['tests/test_admin.py::test_bulk_delete'],
    skipped: [],
    new_tests: [{ node_id: 'tests/test_search.py::test_search', status: 'pass' }],
    missing_tests: ['tests/test_legacy.py::test_old_flow'],
    stable_passes: 4,
    summary: {
      baseline_total: 7,
      current_total: 8,
      regressed: 1,
      fixed: 1,
      still_failing: 1,
      new: 1,
      missing: 1,
      has_regressions: true,
    },
  },
  createdBy: 'u1',
  correlationId: null,
  createdAt: '2026-08-13T10:05:00.000Z',
};

const cleanComparison: RegressionComparison = {
  ...regressedComparison,
  id: 'cmp-2',
  hasRegressions: false,
  result: {
    regressions: [],
    fixes: [],
    still_failing: [],
    skipped: [],
    new_tests: [],
    missing_tests: [],
    stable_passes: 7,
    summary: {
      baseline_total: 7,
      current_total: 7,
      regressed: 0,
      fixed: 0,
      still_failing: 0,
      new: 0,
      missing: 0,
      has_regressions: false,
    },
  },
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/projects/p1/regression']}>
      <AuthProvider>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/projects/:id/regression" element={<RegressionPage />} />
            <Route path="/executions/:id/report" element={<div>Report page</div>} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function pickCandidateAndCompare(user: ReturnType<typeof userEvent.setup>) {
  const baselineSelect = (await screen.findByLabelText(
    'Baseline run',
  )) as HTMLSelectElement;
  // Baseline picker defaults to the run marked isBaseline.
  await waitFor(() => expect(baselineSelect.value).toBe('aaaaaaaa-run1'));
  await user.selectOptions(screen.getByLabelText('Candidate run'), 'bbbbbbbb-run2');
  await user.click(screen.getByRole('button', { name: 'Compare' }));
}

describe('RegressionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockRejectedValue(new Error('no session'));
    listByProject.mockResolvedValue(runs);
    listComparisons.mockResolvedValue([]);
  });

  it('renders both run pickers from the project executions', async () => {
    renderPage();

    const baselineSelect = (await screen.findByLabelText(
      'Baseline run',
    )) as HTMLSelectElement;
    const candidateSelect = screen.getByLabelText('Candidate run') as HTMLSelectElement;

    // Both pickers list both runs (plus the placeholder option).
    expect(baselineSelect.options.length).toBe(3);
    expect(candidateSelect.options.length).toBe(3);
    expect(baselineSelect).toHaveTextContent('aaaaaaaa · passed');
    expect(candidateSelect).toHaveTextContent('bbbbbbbb · failed');
    // The run marked isBaseline is pre-selected as the baseline.
    await waitFor(() => expect(baselineSelect.value).toBe('aaaaaaaa-run1'));
    expect(listByProject).toHaveBeenCalledWith('p1');
  });

  it('runs a comparison and shows the regressions banner with bucket rows', async () => {
    compare.mockResolvedValue(regressedComparison);
    const user = userEvent.setup();
    renderPage();

    await pickCandidateAndCompare(user);

    await waitFor(() =>
      expect(compare).toHaveBeenCalledWith('p1', 'aaaaaaaa-run1', 'bbbbbbbb-run2'),
    );
    expect(await screen.findByText('1 regression detected')).toBeInTheDocument();

    // Bucketed tables list the pytest node ids.
    expect(screen.getByText('Regressions (1)')).toBeInTheDocument();
    expect(screen.getByText('tests/test_login.py::test_login_ok')).toBeInTheDocument();
    expect(screen.getByText('Fixes (1)')).toBeInTheDocument();
    expect(
      screen.getByText('tests/test_login.py::test_reset_password'),
    ).toBeInTheDocument();
    expect(screen.getByText('Still failing (1)')).toBeInTheDocument();
    expect(screen.getByText('New tests (1)')).toBeInTheDocument();
    expect(screen.getByText('tests/test_search.py::test_search')).toBeInTheDocument();
    expect(screen.getByText('Missing tests (1)')).toBeInTheDocument();
  });

  it('shows the clean state when the comparison has no regressions', async () => {
    compare.mockResolvedValue(cleanComparison);
    const user = userEvent.setup();
    renderPage();

    await pickCandidateAndCompare(user);

    expect(await screen.findByText('No regressions')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing changed between the runs'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Regressions \(/)).not.toBeInTheDocument();
  });

  it('surfaces a meaningful error when the comparison fails', async () => {
    compare.mockRejectedValue(
      new ApiClientError(
        { code: 'runs_incomparable', message: 'Baseline run has no results' },
        422,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await pickCandidateAndCompare(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Baseline run has no results',
    );
  });
});
