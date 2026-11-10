import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, parseApiError } from '@/services/api';

/**
 * Minimal data hook: loads `path` on mount and whenever the screen regains focus, with pull-to-refresh
 * support. Pass null to skip. Responses use the backend's { data } envelope.
 */
export function useQuery<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (!path) return;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await api.get<{ data: T }>(path);
      if (!alive.current) return;
      setData(r.data.data);
      setError(null);
    } catch (e) {
      if (alive.current) setError(parseApiError(e).message);
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(Boolean(path));
    void load('initial');
    return () => {
      alive.current = false;
    };
  }, [load, path]);

  useFocusEffect(useCallback(() => void load(), [load]));

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const t = setInterval(() => void load(), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, path, load]);

  return { data, error, loading, refreshing, refresh: () => load('refresh'), reload: () => load() };
}
