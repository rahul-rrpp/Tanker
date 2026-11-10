import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onSessionChange, parseApiError, refreshSession } from '@/services/api';
import { accessTokenStore, tokenStorage } from '@/services/storage/tokenStorage';
import type { AuthUser, MobileAuthData } from '@/types';
import { authService } from '../services/authService';

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
        if (opts.allDevices) await authService.logoutAll();
        else await authService.logout(refreshToken ?? undefined);
      } catch {
        // Best effort: the local session is cleared regardless.
      }
      await clearLocal();
    },
    [clearLocal],
  );

  const reload = useCallback(async () => {
    const { data } = await authService.me();
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

export { homeRouteFor } from '../utils/experience';
