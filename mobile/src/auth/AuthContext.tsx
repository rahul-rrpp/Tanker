import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionChange, parseApiError, refreshSession } from '../api/client';
import { experienceOf, type AuthUser, type MobileAuthData } from '../lib/types';
import { accessTokenStore, tokenStorage } from './tokenStorage';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'offline';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  /** Persist a session returned by login/registration. */
  signIn: (data: MobileAuthData) => Promise<void>;
  signOut: (opts?: { allDevices?: boolean }) => Promise<void>;
  /** Re-fetch the current user (e.g. after an agency approves a driver). */
  reload: () => Promise<void>;
  /** Retry session restoration after a network failure. */
  retry: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearLocal = useCallback(async () => {
    await tokenStorage.clear();
    accessTokenStore.set(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  /** Automatic session restoration on launch: rotate the stored refresh token for a fresh access token. */
  const restore = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const session = await refreshSession();
      if (session) {
        setUser(session.user);
        setStatus('signedIn');
      } else {
        setUser(null);
        setStatus('signedOut');
      }
    } catch (e) {
      setError(parseApiError(e).message);
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    // Keep React state in sync with refreshes/expiries triggered by the API interceptor.
    onSessionChange((data) => {
      if (data) {
        setUser(data.user);
        setStatus('signedIn');
      } else {
        setUser(null);
        setStatus('signedOut');
      }
    });
    void restore();
  }, [restore]);

  const signIn = useCallback(async (data: MobileAuthData) => {
    await tokenStorage.setRefreshToken(data.refreshToken);
    accessTokenStore.set(data.accessToken);
    setUser(data.user);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(
    async (opts: { allDevices?: boolean } = {}) => {
      const refreshToken = await tokenStorage.getRefreshToken();
      try {
        if (opts.allDevices) await api.post('/auth/logout-all');
        else await api.post('/auth/logout', { refreshToken: refreshToken ?? undefined });
      } catch {
        // Best effort: the local session is cleared regardless.
      }
      await clearLocal();
    },
    [clearLocal],
  );

  const reload = useCallback(async () => {
    const { data } = await api.get<{ data: { user: AuthUser } }>('/auth/me');
    setUser(data.data.user);
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signOut, reload, retry: restore, error }),
    [status, user, signIn, signOut, reload, restore, error],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Mobile landing route, derived from backend-provided roles. Unverified transporters and drivers still get
 * their app (to finish their profile or see assignments); the backend decides what they may do.
 */
export function homeRouteFor(user: AuthUser): '/company' | '/transporter' | '/driver' | '/profile' {
  const e = experienceOf(user);
  return e === 'other' ? '/profile' : (`/${e}` as '/company' | '/transporter' | '/driver');
}
