'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiError } from './api';

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface UseApiOptions {
  /** تحديث تلقائي كل N ملّي ثانية (يتوقف عند إخفاء الصفحة) */
  refreshMs?: number;
}

export function useApi<T>(url: string | null, opts: UseApiOptions = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setLoading(true);
      try {
        const d = await apiGet<T>(url, c.signal);
        if (!c.signal.aborted) {
          setData(d);
          setError(null);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (!c.signal.aborted) setError(err as ApiError);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    load();
    return () => ctrl.current?.abort();
  }, [url, load]);

  useEffect(() => {
    if (!url || !opts.refreshMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, opts.refreshMs);
    return () => clearInterval(t);
  }, [url, opts.refreshMs, load]);

  return { data, error, loading, reload: () => load(true), setData };
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
