'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { api } from './api';

export const fetcher = <T,>(url: string) => api.get<{ data: T }>(url).then((r) => r.data.data);

/** SWR wrapper over the company API (cookie session, auto refresh on 401). Pass null to skip. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: true, shouldRetryOnError: false, ...config });
}

/** Decodes a Google encoded polyline (precision 5). */
export function decodePolyline(encoded: string | null | undefined): [number, number][] {
  if (!encoded) return [];
  const pts: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d;
      else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}
