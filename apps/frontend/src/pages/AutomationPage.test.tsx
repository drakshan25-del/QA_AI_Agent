import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API surface the AuthContext + AutomationPage depend on.
const refresh = vi.fn();
const me = vi.fn();
const generate = vi.fn();
const listArtifacts = vi.fn();
const listTestCases = vi.fn();

vi.mock('../services/api/endpoints', () => ({
  authApi: {
    refresh: (...a: unknown[]) => refresh(...a),
    me: (...a: unknown[]) => me(...a),
    login: vi.fn(),
    logout: vi.fn(),
  },
  automationApi: {
    generate: (...a: unknown[]) => generate(...a),
    list: (...a: unknown[]) => listArtifacts(...a),
  },
  testCasesApi: {
    list: (...a: unknown[]) => listTestCases(...a),
  },
  jobsApi: {
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    logs: vi.fn().mockResolvedValue([]),
  },
}));

// Realtime + live console are out of scope for this focused test.
vi.mock('../hooks/useProjectEvents', () => ({
  useProjectEvents: () => ({ last: null, connection: 'disconnected' }),
}));
vi.mock('../components/LiveJobConsole', () => ({
  LiveJobConsole: () => <div data-testid="live-console" />,
}));

import { AutomationPage } from './AutomationPage';
import { AuthProvider } from '../auth/AuthContext';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/projects/p1/automation']}>
      <AuthProvider>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/projects/:id/automation" element={<AutomationPage />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AutomationPage generate options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockRejectedValue(new Error('no session'));
    listArtifacts.mockResolvedValue([]);
    listTestCases.mockResolvedValue({
      items: [{ id: 'tc-1' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
  });

  it('sends the selected test type and regression flag to generate', async () => {
    generate.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole('button', {
      name: 'Generate from 1 approved case',
    });

    await user.selectOptions(screen.getByLabelText('Test type'), 'api');
    await user.click(screen.getByLabelText('Regression suite'));
    await user.click(button);

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith('p1', ['tc-1'], {
        testType: 'api',
        regressionSuite: true,
      }),
    );
  });

  it('defaults to a plain UI generation', async () => {
    generate.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Generate from 1 approved case' }),
    );

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith('p1', ['tc-1'], {
        testType: 'ui',
        regressionSuite: false,
      }),
    );
  });
});
