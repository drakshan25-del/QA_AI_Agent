/**
 * Sign-in prompt for the target application (FR-UIS-002, §16).
 *
 * The credentials typed here are used once, for one scan: they travel to the
 * backend in the start-scan request, are forwarded to the browser session and
 * are never stored, logged or returned. That is stated in the dialog, because
 * a user typing a production password deserves to know what happens to it.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { Modal } from '../../components/ui/Modal';
import { TextInput, Select } from '../../components/ui/Field';
import L from '../../styles/layout.module.css';

export interface ScanCredentials {
  username: string;
  password: string;
  loginUrl: string;
  storageStateId: string;
}

export function ScanCredentialsModal({
  open,
  targetUrl,
  storageStates,
  initialLoginUrl,
  onCancel,
  onSkip,
  onSubmit,
}: {
  open: boolean;
  targetUrl: string;
  storageStates: { id: string; label: string }[];
  initialLoginUrl?: string;
  onCancel: () => void;
  /** Scan the page without signing in. */
  onSkip: () => void;
  onSubmit: (credentials: ScanCredentials) => void;
}): JSX.Element | null {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState(initialLoginUrl ?? '');
  const [storageStateId, setStorageStateId] = useState('');
  const [error, setError] = useState('');
  const firstFieldRef = useRef<HTMLDivElement | null>(null);

  // Never keep a password in component state after the dialog closes.
  useEffect(() => {
    if (!open) {
      setUsername('');
      setPassword('');
      setError('');
      setStorageStateId('');
    } else {
      setLoginUrl(initialLoginUrl ?? '');
      // Focus lands on the first field so the dialog is usable from the
      // keyboard alone.
      window.setTimeout(() => {
        firstFieldRef.current?.querySelector('input')?.focus();
      }, 0);
    }
  }, [open, initialLoginUrl]);

  if (!open) return null;

  const usingStorageState = !!storageStateId;

  const submit = () => {
    if (!usingStorageState && (!username.trim() || !password)) {
      setError(
        'Enter the username and password the scanner should sign in with, ' +
          'or pick a saved authentication state.',
      );
      return;
    }
    onSubmit({
      username: usingStorageState ? '' : username.trim(),
      password: usingStorageState ? '' : password,
      loginUrl: loginUrl.trim(),
      storageStateId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Sign in to the application being scanned"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onSkip}>Scan without signing in</Button>
          <Button variant="primary" onClick={submit}>
            Sign in and scan
          </Button>
        </>
      }
    >
      <p className={L.muted} style={{ marginTop: 0 }}>
        The scanner opens <strong>{targetUrl || 'the target URL'}</strong> in a
        real browser and scans it first, then signs in and scans what it lands
        on. Provide the credentials it should use, or skip to scan the page
        anonymously.
      </p>

      <Banner kind="info">
        Credentials are used for this scan only. They are never written to the
        database, never appear in the scan log and are never sent to the model.
      </Banner>

      <div style={{ marginTop: 14 }} ref={firstFieldRef}>
        <TextInput
          label="Username or email"
          value={username}
          autoComplete="off"
          disabled={usingStorageState}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="qa.user@example.com"
        />
        <TextInput
          label="Password"
          type="password"
          value={password}
          autoComplete="off"
          disabled={usingStorageState}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextInput
          label="Login page URL"
          hint="Only needed when the target page has no sign-in form of its own."
          value={loginUrl}
          onChange={(e) => setLoginUrl(e.target.value)}
          placeholder="https://example.com/login"
        />
        {storageStates.length > 0 && (
          <Select
            label="Saved authentication state"
            hint="Reuse an approved browser session for this project instead of signing in."
            value={storageStateId}
            onChange={(e) => setStorageStateId(e.target.value)}
          >
            <option value="">Sign in with the credentials above</option>
            {storageStates.map((state) => (
              <option key={state.id} value={state.id}>
                {state.label}
              </option>
            ))}
          </Select>
        )}
        {error && <Banner kind="error">{error}</Banner>}
      </div>
    </Modal>
  );
}
