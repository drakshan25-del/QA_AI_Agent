import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API surface the AuthContext + AccountsPage depend on.
const refresh = vi.fn();
const me = vi.fn();
const listUsers = vi.fn();
const setStatus = vi.fn();

vi.mock('../services/api/endpoints', () => ({
  authApi: {
    refresh: (...a: unknown[]) => refresh(...a),
    me: (...a: unknown[]) => me(...a),
    login: vi.fn(),
    logout: vi.fn(),
  },
  usersApi: {
    list: (...a: unknown[]) => listUsers(...a),
    setStatus: (...a: unknown[]) => setStatus(...a),
  },
}));

import { AccountsPage } from './AccountsPage';
import { AuthProvider } from '../auth/AuthContext';
import type { PublicUser } from '../services/api/types';

const superowner: PublicUser = {
  id: 'u-owner',
  email: 'rakshandangol93@gmail.com',
  role: 'superowner',
  name: 'Owner',
  isActive: true,
  createdAt: '2026-08-01T09:00:00.000Z',
};

const accounts: PublicUser[] = [
  superowner,
  {
    id: 'u-qa',
    email: 'qa@example.com',
    role: 'qa_engineer',
    name: 'QA Person',
    isActive: true,
    createdAt: '2026-08-02T09:00:00.000Z',
  },
  {
    id: 'u-dev',
    email: 'dev@example.com',
    role: 'developer',
    name: 'Dev Person',
    isActive: false,
    createdAt: '2026-08-03T09:00:00.000Z',
  },
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      <AuthProvider>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/dashboard" element={<div>Dashboard landing</div>} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockResolvedValue({ accessToken: 'tok' });
    listUsers.mockResolvedValue(accounts);
  });

  it('lists every account for the superowner with status badges', async () => {
    me.mockResolvedValue(superowner);
    renderPage();

    expect(await screen.findByText('qa@example.com')).toBeInTheDocument();
    expect(screen.getByText('dev@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    // The superowner's own row has no enable/disable control.
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('disables an active account', async () => {
    me.mockResolvedValue(superowner);
    setStatus.mockResolvedValue({ ...accounts[1], isActive: false });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('u-qa', false));
  });

  it('re-enables a disabled account', async () => {
    me.mockResolvedValue(superowner);
    setStatus.mockResolvedValue({ ...accounts[2], isActive: true });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('u-dev', true));
  });

  it('redirects non-superowner users to the dashboard', async () => {
    me.mockResolvedValue({
      id: 'u-admin',
      email: 'admin@example.com',
      role: 'admin',
      name: 'Admin',
      isActive: true,
    });
    renderPage();

    expect(await screen.findByText('Dashboard landing')).toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });
});
