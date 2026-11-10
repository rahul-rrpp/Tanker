import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { accessTokenStore, tokenStorage } from '@/services/storage/tokenStorage';
import type { MobileAuthData } from '@/types';
import { API_BASE_URL, CLIENT_HEADERS, REQUEST_TIMEOUT_MS } from './config';
import { ENDPOINTS } from './endpoints';

/** The one HTTP client. Adds the bearer token and refreshes expired sessions transparently. */
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: CLIENT_HEADERS,
});

api.interceptors.request.use((config) => {
  const token = accessTokenStore.get();
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ---------------------------------------------------------------------------
// Single-flight refresh
// ---------------------------------------------------------------------------

type Listener = (data: MobileAuthData | null) => void;
let sessionListener: Listener = () => {};
/** AuthContext subscribes to learn about refreshed sessions (user updates) and expiries (null). */
export function onSessionChange(listener: Listener) {
  sessionListener = listener;
}

let inflight: Promise<MobileAuthData | null> | null = null;

async function doRefresh(): Promise<MobileAuthData | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<{ data: MobileAuthData }>(
      `${API_BASE_URL}${ENDPOINTS.auth.refresh}`,
      { refreshToken },
      { headers: CLIENT_HEADERS, timeout: REQUEST_TIMEOUT_MS },
    );
    await tokenStorage.setRefreshToken(data.data.refreshToken);
    accessTokenStore.set(data.data.accessToken);
    return data.data;
  } catch (e) {
    const err = e as AxiosError;
    // Network problems must not log the user out — keep the refresh token and surface the error.
    if (!err.response || err.response.status === 409) throw e;
    await tokenStorage.clear();
    accessTokenStore.set(null);
    return null;
  }
}

/** Every caller during a refresh awaits the same promise, so the refresh token is rotated exactly once. */
export function refreshSession(): Promise<MobileAuthData | null> {
  inflight ??= doRefresh()
    .then((data) => {
      sessionListener(data);
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const RETRYABLE = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<{ error?: { code?: string } }>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    if (!original || original._retried || error.response?.status !== 401 || !RETRYABLE.has(code ?? '')) {
      // Revoked / reused sessions end the local session immediately.
      if (error.response?.status === 401 && (code === 'SESSION_REVOKED' || code === 'REFRESH_TOKEN_REUSED')) {
        await tokenStorage.clear();
        accessTokenStore.set(null);
        sessionListener(null);
      }
      throw error;
    }
    original._retried = true;
    const session = await refreshSession();
    if (!session) throw error;
    original.headers = { ...original.headers, Authorization: `Bearer ${session.accessToken}` };
    return api(original);
  },
);
