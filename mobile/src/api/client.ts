import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import * as Device from 'expo-device';
import { accessTokenStore, tokenStorage } from '../auth/tokenStorage';
import type { MobileAuthData } from '../lib/types';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000').replace(/\/$/, '');

export const deviceInfo = [Device.manufacturer, Device.modelName, Device.osName && `${Device.osName} ${Device.osVersion ?? ''}`.trim()]
  .filter(Boolean)
  .join(' · ')
  .slice(0, 200) || 'Mobile app';

/** Same backend and endpoints as the web app; `X-Client-Type: mobile` returns tokens in the body. */
export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 20_000,
  headers: { 'X-Client-Type': 'mobile', 'X-Device-Info': deviceInfo },
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
      `${API_URL}/api/v1/auth/refresh`,
      { refreshToken },
      { headers: { 'X-Client-Type': 'mobile', 'X-Device-Info': deviceInfo }, timeout: 20_000 },
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ParsedError {
  message: string;
  code?: string;
  fields: { field: string; message: string }[];
  details?: unknown;
  network?: boolean;
}

export function parseApiError(e: unknown): ParsedError {
  const err = e as AxiosError<{ message?: string; error?: { code?: string; details?: unknown } }>;
  if (err?.isAxiosError) {
    if (!err.response) {
      return { message: 'No internet connection or the server is unreachable. Please try again.', fields: [], network: true };
    }
    const details = err.response.data?.error?.details;
    return {
      message: err.response.data?.message ?? 'Something went wrong',
      code: err.response.data?.error?.code,
      fields: Array.isArray(details) ? (details as ParsedError['fields']) : [],
      details,
    };
  }
  return { message: 'Something went wrong. Please try again.', fields: [] };
}
