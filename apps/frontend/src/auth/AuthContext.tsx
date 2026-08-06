/**
 * Auth context (V2_CONTRACT §1, FR-BE-002). Holds the current user + access
 * token (in memory via tokenStore) and exposes login/logout. On mount it tries
 * a silent refresh using the HTTP-only refresh cookie so a page reload keeps
 * the session without persisting the access token to storage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../services/api/endpoints';
import { tokenStore } from '../services/api/tokenStore';
import { setOnAuthLost } from '../services/api/client';
import type { PublicUser, Role } from '../services/api/types';

interface AuthState {
  user: PublicUser | null;
  status: 'initializing' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('initializing');

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setOnAuthLost(clearSession);
    return () => setOnAuthLost(null);
  }, [clearSession]);

  // Silent bootstrap: try refresh cookie → access token → /me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await authApi.refresh();
        tokenStore.set(accessToken);
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken, user: u } = await authApi.login(email, password);
    tokenStore.set(accessToken);
    setUser(u);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, status, login, logout, hasRole }),
    [user, status, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
