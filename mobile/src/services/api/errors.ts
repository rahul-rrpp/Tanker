import type { AxiosError } from 'axios';

export interface ParsedError {
  message: string;
  code?: string;
  fields: { field: string; message: string }[];
  details?: unknown;
  network?: boolean;
}

/** Turns any thrown value into a message (and field errors) the UI can show. */
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
