import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authApi } from '../services/api/endpoints';
import { SELF_REGISTER_ROLES, type Role } from '../services/api/types';
import { Button } from '../components/ui/Button';
import { TextInput, Select } from '../components/ui/Field';
import { ErrorBanner } from '../components/ui/Banner';
import { FullPageSpinner } from '../components/ui/Spinner';
import { humanCategory } from '../lib/format';
import s from './login.module.css';

interface LocationState {
  from?: string;
}

type Mode = 'signin' | 'signup';

export function LoginPage(): JSX.Element {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/dashboard';

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('qa_engineer');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'initializing') {
    return <FullPageSpinner label="Loading…" />;
  }
  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirm('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      setError(new Error('Passwords do not match'));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await authApi.register({ email, password, role, name: name || undefined });
      }
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className={s.wrap}>
      <form
        className={s.card}
        onSubmit={onSubmit}
        aria-label={isSignup ? 'Create account' : 'Sign in'}
      >
        <div className={s.head}>
          <span className={s.logo} aria-hidden="true">
            QA
          </span>
          <h1 className={s.title}>Agentic QA System</h1>
          <p className={s.sub}>
            {isSignup ? 'Create your account' : 'Sign in to your workspace'}
          </p>
        </div>

        {error != null && <ErrorBanner error={error} />}

        {isSignup && (
          <TextInput
            label="Name"
            type="text"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
          />
        )}
        <TextInput
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        {isSignup && (
          <Select
            label="Role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            hint="Privileged roles are assigned by an administrator"
          >
            {SELF_REGISTER_ROLES.map((r) => (
              <option key={r} value={r}>
                {humanCategory(r)}
              </option>
            ))}
          </Select>
        )}
        <TextInput
          label="Password"
          type="password"
          name="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          required
          minLength={isSignup ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          hint={isSignup ? 'At least 8 characters' : undefined}
        />
        {isSignup && (
          <TextInput
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        )}

        <Button type="submit" variant="primary" block loading={submitting} disabled={submitting}>
          {isSignup
            ? submitting
              ? 'Creating account…'
              : 'Create account'
            : submitting
              ? 'Signing in…'
              : 'Sign in'}
        </Button>

        <p className={s.switchRow}>
          {isSignup ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className={s.switchLink}
                onClick={() => switchMode('signin')}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button
                type="button"
                className={s.switchLink}
                onClick={() => switchMode('signup')}
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
