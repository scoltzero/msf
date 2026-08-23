"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, getToken } from "@/lib/api";
import {
  clearClosedConnections,
  pruneClosedConnections,
  readClosedConnections,
  saveClosedConnections,
  toClosedConnection,
  type ClosedConnectionRecord,
} from "@/components/mihomo/overview/connectionHistory";
import {
  MihomoDashboardDataContext,
  mergeMihomoTrafficHistory,
  normalizeMihomoConnections,
  normalizeMihomoProviderTraffic,
  normalizeMihomoRuleHits,
  unwrapMihomoData,
  type MihomoConnection,
  type MihomoDashboardData,
  type MihomoTrafficPoint,
} from "./useMihomoDashboardData";

let sharedTrafficHistory: MihomoTrafficPoint[] = [];
const POLL_TICK_MS = 1_000;

export type MihomoDashboardScope = "overview" | "connections" | "providers" | "rules" | "traffic";
export const MIHOMO_CONNECTION_HISTORY_ENABLED_KEY = "msf-mihomo-dashboard-connection-history-enabled-v1";

export function mihomoDashboardScopesForWidgetTypes(types: readonly string[]): MihomoDashboardScope[] {
  const scopes = new Set<MihomoDashboardScope>();
  types.forEach((type) => {
    if (type === "mihomo-traffic") { scopes.add("traffic"); scopes.add("overview"); }
    if (["mihomo-globe", "mihomo-topology", "mihomo-connection-stats"].includes(type)) scopes.add("connections");
    if (type === "mihomo-provider-traffic") scopes.add("providers");
    if (type === "mihomo-rule-hits") scopes.add("rules");
  });
  return Array.from(scopes);
}

export function resolveMihomoDashboardScopes(visibleScopes: readonly MihomoDashboardScope[], connectionHistoryEnabled: boolean) {
  const scopes = new Set(visibleScopes);
  if (connectionHistoryEnabled) scopes.add("connections");
  return scopes;
}

type ReconcileConnectionHistoryOptions = {
  previous: Map<string, MihomoConnection> | null;
  connections: MihomoConnection[];
  save?: (rows: ClosedConnectionRecord[]) => Promise<void>;
  read?: () => Promise<ClosedConnectionRecord[]>;
};

export async function reconcileMihomoConnectionHistory({
  previous,
  connections,
  save = saveClosedConnections,
  read = readClosedConnections,
}: ReconcileConnectionHistoryOptions) {
  const current = new Map(connections.map((row) => [String(row.id), row]));
  if (!previous) return { current, closedConnections: undefined };
  const ended = Array.from(previous).filter(([id]) => !current.has(id)).map(([, row]) => toClosedConnection(row));
  if (!ended.length) return { current, closedConnections: undefined };
  await save(ended);
  return { current, closedConnections: await read() };
}

type TrafficStreamOptions = {
  token: () => string;
  url: (token: string) => string;
  createSocket: (url: string) => WebSocket;
  retry: (callback: () => void, delay: number) => number;
  cancelRetry: (timer: number) => void;
  onOpen: () => void;
  onMessage: (payload: unknown) => void;
  onClose: () => void;
};

type RestScope = Exclude<MihomoDashboardScope, "traffic">;
type PollingOptions = {
  scopes: ReadonlySet<MihomoDashboardScope>;
  refresh: Record<RestScope, () => void>;
  lastPollAt: Record<string, number>;
  now: () => number;
  hidden: () => boolean;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (timer: number) => void;
  addVisibilityListener: (callback: () => void) => void;
  removeVisibilityListener: (callback: () => void) => void;
};

/** Starts only the REST polling required by the current widget consumers. */
export function startMihomoDashboardPolling(options: PollingOptions) {
  const restScopes = (["overview", "connections", "providers", "rules"] as const).filter((scope) => options.scopes.has(scope));
  if (!restScopes.length) return () => {};
  const refreshAll = () => {
    const now = options.now();
    restScopes.forEach((scope) => {
      options.lastPollAt[scope] = now;
      options.refresh[scope]();
    });
  };
  refreshAll();
  const timer = options.setInterval(() => {
    const now = options.now();
    const hidden = options.hidden();
    const due = (scope: RestScope, visibleMs: number, hiddenMs: number) => {
      const interval = hidden ? hiddenMs : visibleMs;
      if (now - (options.lastPollAt[scope] ?? 0) < interval) return false;
      options.lastPollAt[scope] = now;
      return true;
    };
    if (options.scopes.has("overview") && due("overview", 1_000, 10_000)) options.refresh.overview();
    if (options.scopes.has("connections") && due("connections", 2_000, 10_000)) options.refresh.connections();
    if (options.scopes.has("providers") && due("providers", 60_000, 120_000)) options.refresh.providers();
    if (options.scopes.has("rules") && due("rules", 10_000, 60_000)) options.refresh.rules();
  }, POLL_TICK_MS);
  const visible = () => { if (!options.hidden()) refreshAll(); };
  options.addVisibilityListener(visible);
  return () => {
    options.clearInterval(timer);
    options.removeVisibilityListener(visible);
  };
}

/** Owns one reconnecting traffic socket. Calling the returned cleanup is final. */
export function startMihomoTrafficStream(options: TrafficStreamOptions) {
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let stopped = false;
  const connect = () => {
    if (stopped) return;
    const token = options.token();
    if (!token) { retryTimer = options.retry(connect, 2_000); return; }
    socket = options.createSocket(options.url(token));
    socket.onopen = () => { if (!stopped) options.onOpen(); };
    socket.onmessage = (event) => {
      try { if (!stopped) options.onMessage(JSON.parse(String(event.data))); } catch { /* keep the latest valid sample */ }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      socket = null;
      if (stopped) return;
      options.onClose();
      retryTimer = options.retry(connect, 2_000);
    };
  };
  connect();
  return () => {
    stopped = true;
    options.cancelRetry(retryTimer);
    socket?.close();
    socket = null;
  };
}

type Snapshot = Omit<MihomoDashboardData, "refresh" | "clearConnectionHistory" | "applyConnectionRetention">;
const initialSnapshot: Snapshot = {
  overview: {}, connections: [], providers: [], ruleHits: [], trafficHistory: sharedTrafficHistory,
  closedConnections: [], trafficConnected: false, loading: true, error: "",
};

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function MihomoDashboardProvider({ children, enabledScopes, connectionHistoryRequested = false }: { children: ReactNode; enabledScopes: readonly MihomoDashboardScope[]; connectionHistoryRequested?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ ...initialSnapshot, trafficHistory: sharedTrafficHistory }));
  const mounted = useRef(true);
  const requests = useRef(new Map<string, AbortController>());
  const previousConnections = useRef<Map<string, MihomoConnection> | null>(null);
  const connectionCount = useRef(0);
  const socketSampleAt = useRef(0);
  const lastPollAt = useRef<Record<string, number>>({});
  const [connectionHistoryEnabled, setConnectionHistoryEnabled] = useState(() => {
    try { return localStorage.getItem(MIHOMO_CONNECTION_HISTORY_ENABLED_KEY) === "true"; } catch { return false; }
  });
  const enabledKey = [...resolveMihomoDashboardScopes(enabledScopes, connectionHistoryEnabled || connectionHistoryRequested)].sort().join("|");
  const enabled = useMemo(() => new Set(enabledKey ? enabledKey.split("|") as MihomoDashboardScope[] : []), [enabledKey]);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const appendTraffic = useCallback((point: MihomoTrafficPoint) => {
    setSnapshot((current) => {
      const trafficHistory = mergeMihomoTrafficHistory(current.trafficHistory, point);
      sharedTrafficHistory = trafficHistory;
      return { ...current, trafficHistory };
    });
  }, []);

  const load = useCallback(async (key: string, path: string, apply: (payload: unknown) => void | Promise<void>) => {
    if (requests.current.has(key)) return;
    const controller = new AbortController();
    requests.current.set(key, controller);
    try {
      const payload = await api(path, { signal: controller.signal });
      if (mounted.current && enabledRef.current.has(key as MihomoDashboardScope)) await apply(payload);
    } catch (error) {
      if (mounted.current && enabledRef.current.has(key as MihomoDashboardScope) && (error as { name?: unknown })?.name !== "AbortError") {
        setSnapshot((current) => ({ ...current, loading: false, error: message(error) }));
      }
    } finally {
      if (requests.current.get(key) === controller) requests.current.delete(key);
    }
  }, []);

  const refreshOverview = useCallback(() => load("overview", "/api/v1/mihomo/overview", (payload) => {
    const overview = unwrapMihomoData(payload);
    const stats = overview.stats ?? overview;
    const connections = Number(overview.activeConnections ?? overview.active_connections ?? stats.activeConnections ?? stats.active_connections ?? 0) || 0;
    connectionCount.current = connections;
    setSnapshot((current) => ({ ...current, overview, loading: false, error: "" }));
    if (Date.now() - socketSampleAt.current > 2_500) {
      appendTraffic({
        timestamp: Date.now(),
        downloadSpeed: Number(overview.downloadSpeed ?? overview.download_speed ?? stats.downloadSpeed ?? stats.download_speed ?? 0) || 0,
        uploadSpeed: Number(overview.uploadSpeed ?? overview.upload_speed ?? stats.uploadSpeed ?? stats.upload_speed ?? 0) || 0,
        connections,
      });
    }
  }), [appendTraffic, load]);

  const refreshConnections = useCallback(() => load("connections", "/api/v1/mihomo/connections", async (payload) => {
    const connections = normalizeMihomoConnections(payload);
    connectionCount.current = connections.length;
    const history = await reconcileMihomoConnectionHistory({ previous: previousConnections.current, connections });
    previousConnections.current = history.current;
    if (history.closedConnections && mounted.current) setSnapshot((current) => ({ ...current, closedConnections: history.closedConnections! }));
    if (mounted.current) setSnapshot((current) => ({ ...current, connections }));
  }), [load]);

  const refreshProviders = useCallback(() => load("providers", "/api/v1/mihomo/proxy-providers", (payload) => {
    setSnapshot((current) => ({ ...current, providers: normalizeMihomoProviderTraffic(payload) }));
  }), [load]);

  const refreshRules = useCallback(() => load("rules", "/api/v1/mihomo/rules?page_size=10000", (payload) => {
    setSnapshot((current) => ({ ...current, ruleHits: normalizeMihomoRuleHits(payload) }));
  }), [load]);

  const refresh = useCallback(async () => {
    const scopes = enabledRef.current;
    await Promise.all([
      scopes.has("overview") ? refreshOverview() : Promise.resolve(),
      scopes.has("connections") ? refreshConnections() : Promise.resolve(),
      scopes.has("providers") ? refreshProviders() : Promise.resolve(),
      scopes.has("rules") ? refreshRules() : Promise.resolve(),
    ]);
  }, [refreshConnections, refreshOverview, refreshProviders, refreshRules]);

  const clearConnectionHistory = useCallback(async () => {
    await clearClosedConnections();
    setSnapshot((current) => ({ ...current, closedConnections: [] }));
  }, []);

  const applyConnectionRetention = useCallback(async (days: number) => {
    if (days > 0) await pruneClosedConnections(Date.now() - days * 86_400_000);
    const closedConnections = await readClosedConnections();
    if (mounted.current) setSnapshot((current) => ({ ...current, closedConnections }));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current.forEach((controller) => controller.abort());
      requests.current.clear();
    };
  }, []);

  useEffect(() => {
    requests.current.forEach((controller, scope) => {
      if (!enabled.has(scope as MihomoDashboardScope)) {
        controller.abort();
        requests.current.delete(scope);
      }
    });
  }, [enabled]);

  useEffect(() => {
    if (!connectionHistoryRequested || connectionHistoryEnabled) return;
    try { localStorage.setItem(MIHOMO_CONNECTION_HISTORY_ENABLED_KEY, "true"); } catch { /* continuity still lasts for this session */ }
    setConnectionHistoryEnabled(true);
  }, [connectionHistoryEnabled, connectionHistoryRequested]);

  useEffect(() => {
    if (!enabled.has("connections")) {
      previousConnections.current = null;
      return;
    }
    void (async () => {
      const retention = Number(localStorage.getItem("msf-mihomo-history-cleanup-days") || 30);
      if (retention > 0) await pruneClosedConnections(Date.now() - retention * 86_400_000);
      const closedConnections = await readClosedConnections();
      if (mounted.current && enabledRef.current.has("connections")) setSnapshot((current) => ({ ...current, closedConnections }));
    })();
  }, [enabled]);

  useEffect(() => {
    const apiEnabled = (["overview", "connections", "providers", "rules"] as const).some((scope) => enabled.has(scope));
    if (!apiEnabled) {
      setSnapshot((current) => ({ ...current, loading: false, error: "" }));
      return;
    }
    return startMihomoDashboardPolling({
      scopes: enabled,
      refresh: {
        overview: () => { void refreshOverview(); },
        connections: () => { void refreshConnections(); },
        providers: () => { void refreshProviders(); },
        rules: () => { void refreshRules(); },
      },
      lastPollAt: lastPollAt.current,
      now: Date.now,
      hidden: () => document.visibilityState !== "visible",
      setInterval: (callback, delay) => window.setInterval(callback, delay),
      clearInterval: (timer) => window.clearInterval(timer),
      addVisibilityListener: (callback) => document.addEventListener("visibilitychange", callback),
      removeVisibilityListener: (callback) => document.removeEventListener("visibilitychange", callback),
    });
  }, [enabled, refreshConnections, refreshOverview, refreshProviders, refreshRules]);

  useEffect(() => {
    if (!enabled.has("traffic")) {
      setSnapshot((current) => current.trafficConnected ? { ...current, trafficConnected: false } : current);
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return startMihomoTrafficStream({
      token: getToken,
      url: (token) => `${protocol}//${window.location.host}/api/v1/mihomo/controller/traffic?token=${encodeURIComponent(token)}`,
      createSocket: (url) => new WebSocket(url),
      retry: (callback, delay) => window.setTimeout(callback, delay),
      cancelRetry: (timer) => window.clearTimeout(timer),
      onOpen: () => { if (mounted.current) setSnapshot((current) => ({ ...current, trafficConnected: true })); },
      onMessage: (value) => {
        const payload = value as Record<string, unknown>;
        const timestamp = Date.now();
        socketSampleAt.current = timestamp;
        if (mounted.current) appendTraffic({ timestamp, downloadSpeed: Number(payload.down ?? payload.download) || 0, uploadSpeed: Number(payload.up ?? payload.upload) || 0, connections: connectionCount.current });
      },
      onClose: () => { if (mounted.current) setSnapshot((current) => ({ ...current, trafficConnected: false })); },
    });
  }, [appendTraffic, enabled]);

  const value = useMemo<MihomoDashboardData>(() => ({ ...snapshot, refresh, clearConnectionHistory, applyConnectionRetention }), [applyConnectionRetention, clearConnectionHistory, refresh, snapshot]);
  return <MihomoDashboardDataContext.Provider value={value}>{children}</MihomoDashboardDataContext.Provider>;
}
