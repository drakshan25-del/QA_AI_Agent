import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock the API surface the AuthContext + LoginPage depend on.
const login = vi.fn();
const refresh = vi.fn();
const me = vi.fn();
const logout = vi.fn();
const register = vi.fn();

vi.mock('../services/api/endpoints', () => ({
  authApi: {
    login: (...a: unknown[]) => login(...a),
    refresh: (...a: unknown[]) => refresh(...a),
    me: (...a: unknown[]) => me(...a),
    logout: (...a: unknown[]) => logout(...a),
    register: (...a: unknown[]) => register(...a),
  },
}));

import { LoginPage } from './LoginPage';
import { AuthProvider } from '../auth/AuthContext';
import { ApiClientError } from '../services/api/client';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard landing</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No refresh cookie session at boot → land on the login form.
    refresh.mockRejectedValue(new Error('no session'));
  });

  it('renders the sign-in form once the silent refresh fails', async () => {
    renderLogin();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('submits entered credentials and navigates on success', async () => {
    login.mockResolvedValue({
      accessToken: 'tok',
      user: { id: 'u1', email: 'qa@example.com', role: 'qa_engineer', name: 'QA' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText('Email'), 'qa@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('qa@example.com', 'secret123'));
    expect(await screen.findByText('Dashboard landing')).toBeInTheDocument();
  });

  it('shows a meaningful error when the credentials are rejected', async () => {
    login.mockRejectedValue(
      new ApiClientError({ code: 'invalid_credentials', message: 'Invalid email or password' }, 401),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText('Email'), 'qa@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    // Still on the login form (no navigation away).
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('registers a new account and signs in automatically', async () => {
    register.mockResolvedValue({
      id: 'u2',
      email: 'new@example.com',
      role: 'qa_engineer',
      name: 'New User',
      isActive: true,
    });
    login.mockResolvedValue({
      accessToken: 'tok',
      user: { id: 'u2', email: 'new@example.com', role: 'qa_engineer', name: 'New User' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Name'), 'New User');
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'secret123',
        role: 'qa_engineer',
        name: 'New User',
      }),
    );
    await waitFor(() => expect(login).toHaveBeenCalledWith('new@example.com', 'secret123'));
    expect(await screen.findByText('Dashboard landing')).toBeInTheDocument();
  });

  it('blocks sign-up when the passwords do not match', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(register).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it('can switch back to the sign-in form', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
