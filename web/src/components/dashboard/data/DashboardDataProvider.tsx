"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, getToken } from "@/lib/api";
import {
  EMPTY_SYSTEM_DASHBOARD_SNAPSHOT,
  SystemDashboardDataContext,
  mergeSystemHistory,
  normalizeDashboardService,
  normalizeSystemMonitorPoint,
  parseSseBlocks,
  unwrapApiData,
  unwrapApiList,
  type SystemDashboardSnapshot,
} from "./useSystemDashboardData";

const POLL_INTERVAL_MS = 3_000;
const HISTORY_INTERVAL_MS = 30_000;
const STREAM_RETRY_MS = 1_000;

let sharedHistoryCache = EMPTY_SYSTEM_DASHBOARD_SNAPSHOT.history;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SystemDashboardSnapshot>(() => ({
    ...EMPTY_SYSTEM_DASHBOARD_SNAPSHOT,
    history: sharedHistoryCache,
  }));
  const mountedRef = useRef(true);
  const requestsRef = useRef({ polling: false, history: false, services: false });

  const updateHistory = useCallback((points: ReturnType<typeof normalizeSystemMonitorPoint>[]) => {
    setSnapshot((previous) => {
      const history = mergeSystemHistory(previous.history, points);
      sharedHistoryCache = history;
      return history === previous.history ? previous : { ...previous, history };
    });
  }, []);

  const refreshCore = useCallback(async () => {
    if (requestsRef.current.polling) return;
    requestsRef.current.polling = true;
    const results = await Promise.allSettled([
      api("/api/v1/monitor/system"),
      api("/api/v1/monitor/resources"),
      api("/api/v1/monitor/network"),
    ]);
    requestsRef.current.polling = false;
    if (!mountedRef.current) return;
    const failures = results.filter((result) => result.status === "rejected");
    setSnapshot((previous) => ({
      ...previous,
      system: results[0].status === "fulfilled" ? unwrapApiData(results[0].value) : previous.system,
      resources: results[1].status === "fulfilled" ? unwrapApiData(results[1].value) : previous.resources,
      network: results[2].status === "fulfilled" ? unwrapApiData(results[2].value) : previous.network,
      loading: false,
      error: failures.length === results.length ? errorMessage((failures[0] as PromiseRejectedResult).reason) : "",
      lastUpdatedAt: failures.length === results.length ? previous.lastUpdatedAt : Date.now(),
    }));
  }, []);

  const refreshServices = useCallback(async () => {
    if (requestsRef.current.services) return;
    requestsRef.current.services = true;
    try {
      const payload = await api("/api/v1/services");
      if (!mountedRef.current) return;
      const services = unwrapApiList(payload).map(normalizeDashboardService);
      setSnapshot((previous) => ({ ...previous, services, loading: false, lastUpdatedAt: Date.now() }));
    } catch (error) {
      if (mountedRef.current) setSnapshot((previous) => ({ ...previous, loading: false, error: errorMessage(error) }));
    } finally {
      requestsRef.current.services = false;
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (requestsRef.current.history) return;
    requestsRef.current.history = true;
    try {
      const payload = await api("/api/v1/monitor/history");
      if (!mountedRef.current) return;
      updateHistory(unwrapApiList(payload, ["data", "history", "items"]).map(normalizeSystemMonitorPoint));
    } catch (error) {
      if (mountedRef.current) setSnapshot((previous) => ({ ...previous, error: previous.history.length ? previous.error : errorMessage(error) }));
    } finally {
      requestsRef.current.history = false;
    }
  }, [updateHistory]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshCore(), refreshServices(), refreshHistory()]);
  }, [refreshCore, refreshHistory, refreshServices]);

  const runServiceAction = useCallback(async (serviceKey: string, action: "start" | "stop" | "restart") => {
    const payload = await api<Record<string, any>>(`/api/v1/services/${encodeURIComponent(serviceKey)}/${action}?wait=1&timeout=5`, { method: "POST" });
    if (payload.success === false) throw new Error(String(payload.error || payload.message || "服务操作失败"));
    await refreshServices();
  }, [refreshServices]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void Promise.all([refreshCore(), refreshServices()]);
    }, POLL_INTERVAL_MS);
    const historyTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshHistory();
    }, HISTORY_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      window.clearInterval(pollTimer);
      window.clearInterval(historyTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, refreshCore, refreshHistory, refreshServices]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let retryTimer: number | null = null;

    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const token = getToken();
          const response = await fetch("/api/v1/events/monitor", {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`monitor stream ${response.status}`);
          if (mountedRef.current) setSnapshot((previous) => ({ ...previous, streamConnected: true }));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseBlocks(buffer);
            buffer = parsed.rest;
            const points = parsed.events
              .filter(({ event }) => event === "message" || event === "monitor")
              .map(({ data }) => {
                try { return normalizeSystemMonitorPoint(JSON.parse(data)); } catch { return null; }
              });
            if (points.some(Boolean)) updateHistory(points);
          }
        } catch (error) {
          if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        } finally {
          if (mountedRef.current) setSnapshot((previous) => ({ ...previous, streamConnected: false }));
        }
        if (!stopped) await new Promise<void>((resolve) => { retryTimer = window.setTimeout(resolve, STREAM_RETRY_MS); });
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [updateHistory]);

  const value = useMemo(() => ({ ...snapshot, refresh, refreshServices, runServiceAction }), [refresh, refreshServices, runServiceAction, snapshot]);
  return <SystemDashboardDataContext.Provider value={value}>{children}</SystemDashboardDataContext.Provider>;
}
