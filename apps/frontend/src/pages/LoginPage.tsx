import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { ErrorBanner } from '../components/ui/Banner';
import { FullPageSpinner } from '../components/ui/Spinner';
import s from './login.module.css';

interface LocationState {
  from?: string;
}

export function LoginPage(): JSX.Element {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'initializing') {
    return <FullPageSpinner label="Loading…" />;
  }
  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={onSubmit} aria-label="Sign in">
        <div className={s.head}>
          <span className={s.logo} aria-hidden="true">
            QA
          </span>
          <h1 className={s.title}>Agentic QA System</h1>
          <p className={s.sub}>Sign in to your workspace</p>
        </div>

        {error != null && <ErrorBanner error={error} />}

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
        <TextInput
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        <Button type="submit" variant="primary" block loading={submitting} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
