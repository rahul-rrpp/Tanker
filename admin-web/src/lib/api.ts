'use client';

import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import useSWR, { type SWRConfiguration } from 'swr';

type Envelope = { success: boolean; message: string; data: unknown; error?: { code: string; details?: unknown } };

/** Calls /api/v1 on this origin (proxied to the backend), so httpOnly session cookies travel automatically. */
export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 30_000 });

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
};

api.interceptors.request.use((config) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes((config.method ?? 'get').toUpperCase())) {
    const csrf = readCookie('ttms_csrf');
    if (csrf) config.headers.set('X-CSRF-Token', csrf);
  }
  return config;
});

let refreshing: Promise<boolean> | null = null;
const refresh = async () => {
  try {
    await api.post('/auth/refresh', {}, { _skip: true } as AxiosRequestConfig);
    return true;
  } catch (e) {
    return (e as AxiosError<Envelope>).response?.data?.error?.code === 'REFRESH_CONFLICT';
  }
};

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<Envelope>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean; _skip?: boolean }) | undefined;
    const code = error.response?.data?.error?.code ?? '';
    if (!original || original._retried || original._skip || error.response?.status !== 401 || !['TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(code)) throw error;
    original._retried = true;
    refreshing ??= refresh().finally(() => { refreshing = null; });
    if (await refreshing) return api(original);
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}&reason=expired`;
    }
    throw error;
  },
);

export type ApiError = { message: string; status?: number; code?: string; fields: { field: string; message: string }[] };

export function parseApiError(e: unknown): ApiError {
  const err = e as AxiosError<Envelope>;
  if (err?.isAxiosError) {
    if (!err.response) return { message: 'Cannot reach the server. Check that the backend is running.', fields: [] };
    const details = err.response.data?.error?.details;
    return {
      message: err.response.data?.message ?? 'Something went wrong',
      status: err.response.status,
      code: err.response.data?.error?.code,
      fields: Array.isArray(details) ? (details as ApiError['fields']) : [],
    };
  }
  return { message: (e as Error)?.message || 'Something went wrong', fields: [] };
}

export const fetcher = <T,>(url: string) => api.get<{ data: T }>(url).then((r) => r.data.data);

/** SWR over the admin API. Pass null to skip. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: true, shouldRetryOnError: false, ...config });
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
}
