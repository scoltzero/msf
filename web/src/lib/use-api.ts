import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export interface QueryState<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => Promise<T | null>;
}

export function useApiQuery<T = any>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  intervalMs = 0,
  enabled = true
): QueryState<T> {
  const mounted = useRef(true);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loader();
      if (mounted.current) {
        setData(next);
        setError("");
      }
      return next;
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) { setLoading(false); return () => { mounted.current = false; }; }
    void reload();
    if (!intervalMs) {
      return () => {
        mounted.current = false;
      };
    }
    const id = window.setInterval(() => void reload(), intervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [reload, intervalMs, enabled]);

  return { data, error, loading, reload };
}

export function useApiPath<T = any>(path: string, deps: unknown[] = [], intervalMs = 0, enabled = true) {
  return useApiQuery<T>(() => api<T>(path), [path, ...deps], intervalMs, enabled);
}
