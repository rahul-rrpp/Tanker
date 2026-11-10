'use client';

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { ApiEnvelope } from './types';

/**
 * Browser API client. Calls go to /api/v1 on the web origin (proxied to the backend by Next.js), so
 * the httpOnly session cookies are sent automatically. Tokens are never readable from JavaScript.
 */
export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 20_000 });

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

// Double-submit CSRF token on every state-changing request.
api.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('ttms_csrf');
    if (csrf) config.headers.set('X-CSRF-Token', csrf);
  }
  return config;
});

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  try {
    await api.post('/auth/refresh', {}, { _skipAuthRetry: true } as AxiosRequestConfig);
    return true;
  } catch (e) {
    // Another tab refreshed at the same moment: its new cookies are already in place.
    return (e as AxiosError<ApiEnvelope<unknown>>).response?.data?.error?.code === 'REFRESH_CONFLICT';
  }
}

const RETRYABLE = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean; _skipAuthRetry?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    if (!original || original._retried || original._skipAuthRetry || error.response?.status !== 401 || !RETRYABLE.has(code ?? '')) {
      throw error;
    }
    original._retried = true;
    refreshing ??= refreshSession().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return api(original);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}&reason=expired`;
    }
    throw error;
  },
);

export interface ParsedApiError {
  message: string;
  code?: string;
  status?: number;
  fields: { field: string; message: string }[];
  details?: unknown;
}

export function parseApiError(e: unknown): ParsedApiError {
  const err = e as AxiosError<ApiEnvelope<unknown>>;
  if (err?.isAxiosError) {
    if (!err.response) return { message: 'Cannot reach the server. Check your connection and try again.', fields: [] };
    const body = err.response.data;
    const details = body?.error?.details;
    const fields = Array.isArray(details) ? (details as { field: string; message: string }[]) : [];
    return { message: body?.message ?? 'Something went wrong', code: body?.error?.code, status: err.response.status, fields, details };
  }
  return { message: 'Something went wrong. Please try again.', fields: [] };
}

/** Maps backend validation errors onto react-hook-form fields; returns the general message. */
export function applyApiError<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, known: readonly string[]): ParsedApiError {
  const parsed = parseApiError(e);
  for (const f of parsed.fields) {
    if (known.includes(f.field)) setError(f.field as Path<T>, { type: 'server', message: f.message });
  }
  return parsed;
}
