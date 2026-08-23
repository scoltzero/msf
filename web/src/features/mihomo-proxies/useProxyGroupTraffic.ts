"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type ProxyGroupTrafficRate = {
  /** Upload bytes per second. */
  up: number;
  /** Download bytes per second. */
  down: number;
  /** Combined upload and download bytes per second. */
  total: number;
};

export type ProxyGroupTrafficMap = Record<string, ProxyGroupTrafficRate>;

export type ProxyConnectionCounter = {
  upload: number;
  download: number;
  sampledAt: number;
};

export type ProxyConnectionRow = {
  id: string;
  upload: number;
  download: number;
  chains: string[];
};

export type ProxyGroupTrafficSample = {
  /** Counters retained for the next sample; ended connections are omitted. */
  counters: Map<string, ProxyConnectionCounter>;
  traffic: ProxyGroupTrafficMap;
  sampledAt: number;
};

export type ProxyConnectionsFetcher = (path: string, signal?: AbortSignal) => Promise<unknown>;

export type UseProxyGroupTrafficOptions = {
  enabled?: boolean;
  /** Polling interval in milliseconds. Defaults to two seconds. */
  intervalMs?: number;
  fetcher?: ProxyConnectionsFetcher;
  now?: () => number;
};

export type UseProxyGroupTrafficResult = {
  /** Group/proxy-chain name to current estimated bytes per second. */
  traffic: ProxyGroupTrafficMap;
  /** Alias for callers that prefer an explicit group name. */
  groupTraffic: ProxyGroupTrafficMap;
  counters: ReadonlyMap<string, ProxyConnectionCounter>;
  sampledAt?: number;
  loading: boolean;
  error?: string;
  visible: boolean;
  refresh(): Promise<ProxyGroupTrafficMap | undefined>;
};

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function finiteNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function connectionArray(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (depth > 3) return [];
  const row = asRecord(value);
  if (!row) return [];
  for (const key of ["connections", "items"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return row.data === undefined ? [] : connectionArray(row.data, depth + 1);
}

/** Read all supported `/mihomo/connections` response envelopes. */
export function extractProxyConnections(payload: unknown): unknown[] {
  return connectionArray(payload);
}

function namesFromChain(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const row = asRecord(item);
        return row ? [text(row.name ?? row.proxy ?? row.value)] : [text(item)];
      })
      .filter(Boolean);
  }
  const raw = text(value);
  if (!raw) return [];
  // The backend emits an array plus a " / " display string. Accept the
  // common display separators as a compatibility fallback for direct calls.
  return raw.split(/\s*(?:\/|›|→|->)\s*/).map((name) => name.trim()).filter(Boolean);
}

function counterValue(row: RecordValue, keys: readonly string[]): number {
  for (const key of keys) {
    if (row[key] !== undefined) return finiteNumber(row[key]);
  }
  return 0;
}

/** Normalize one connection row without deriving a rate from its totals. */
export function normalizeProxyConnection(value: unknown, index = 0): ProxyConnectionRow | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const id = text(row.id ?? row.ID) || `connection-${index + 1}`;
  const chainValue = row.chains ?? row.chain;
  const chains = Array.from(new Set(namesFromChain(chainValue)));
  return {
    id,
    upload: counterValue(row, ["upload", "upload_total", "uploadTotal"]),
    download: counterValue(row, ["download", "download_total", "downloadTotal"]),
    chains,
  };
}

/** Normalize the connection list while preserving stable connection IDs. */
export function normalizeProxyConnections(payload: unknown): ProxyConnectionRow[] {
  const byId = new Map<string, ProxyConnectionRow>();
  extractProxyConnections(payload).forEach((value, index) => {
    const row = normalizeProxyConnection(value, index);
    if (row) byId.set(row.id, row);
  });
  return Array.from(byId.values());
}

function previousCounter(previous: ReadonlyMap<string, ProxyConnectionCounter> | undefined, id: string): ProxyConnectionCounter | undefined {
  return previous?.get(id);
}

function rateDelta(current: number, previous: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || current < previous) return 0;
  return Math.max(0, (current - previous) * 1000 / elapsedMs);
}

/**
 * Derive per-chain-name rates from cumulative connection counters.
 *
 * The first sample and newly seen connections deliberately contribute zero.
 * A counter rollback is treated as a reset, not as a negative transfer. The
 * returned counter map only contains connections present in this sample, so
 * ended connections naturally disappear from the next aggregate.
 */
export function sampleProxyGroupTraffic(
  previous: ReadonlyMap<string, ProxyConnectionCounter> | undefined,
  payload: unknown,
  sampledAt: number,
): ProxyGroupTrafficSample {
  const currentRows = normalizeProxyConnections(payload);
  const counters = new Map<string, ProxyConnectionCounter>();
  const traffic: ProxyGroupTrafficMap = {};

  for (const row of currentRows) {
    const previousRow = previousCounter(previous, row.id);
    const elapsedMs = previousRow ? sampledAt - previousRow.sampledAt : 0;
    const up = previousRow ? rateDelta(row.upload, previousRow.upload, elapsedMs) : 0;
    const down = previousRow ? rateDelta(row.download, previousRow.download, elapsedMs) : 0;
    counters.set(row.id, { upload: row.upload, download: row.download, sampledAt });
    for (const name of row.chains) {
      const existing = traffic[name] ?? { up: 0, down: 0, total: 0 };
      existing.up += up;
      existing.down += down;
      existing.total = existing.up + existing.down;
      traffic[name] = existing;
    }
  }

  return { counters, traffic, sampledAt };
}

// Explicit aliases make the pure operation discoverable to callers that use
// either “sample” or “aggregate” terminology.
export const aggregateProxyGroupTraffic = sampleProxyGroupTraffic;
export const updateProxyGroupTraffic = sampleProxyGroupTraffic;

export function proxyGroupTrafficEqual(left: ProxyGroupTrafficMap, right: ProxyGroupTrafficMap): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const a = left[key];
    const b = right[key];
    return Boolean(b && a.up === b.up && a.down === b.down && a.total === b.total);
  });
}

const defaultFetcher: ProxyConnectionsFetcher = (path, signal) => api<unknown>(path, signal ? { signal } : undefined);

function documentVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

export function useProxyGroupTraffic(options: UseProxyGroupTrafficOptions = {}): UseProxyGroupTrafficResult {
  const enabled = options.enabled !== false;
  const intervalMs = Math.max(0, options.intervalMs ?? 2_000);
  const fetcher = options.fetcher ?? defaultFetcher;
  const now = options.now ?? Date.now;
  const [visible, setVisible] = useState(documentVisible);
  const [traffic, setTraffic] = useState<ProxyGroupTrafficMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const countersRef = useRef(new Map<string, ProxyConnectionCounter>());
  const sampledAtRef = useRef<number | undefined>(undefined);
  const hasSampleRef = useRef(false);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const sequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  const resetSampling = useCallback(() => {
    requestRef.current?.abort();
    countersRef.current = new Map();
    sampledAtRef.current = undefined;
    hasSampleRef.current = false;
    setTraffic((current) => Object.keys(current).length === 0 ? current : {});
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (!nextVisible) resetSampling();
    };
    setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [resetSampling]);

  useEffect(() => {
    if (!enabled) resetSampling();
  }, [enabled, resetSampling]);

  const refresh = useCallback(async (): Promise<ProxyGroupTrafficMap | undefined> => {
    if (!enabled || !visible) return undefined;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++sequenceRef.current;
    const initialSample = !hasSampleRef.current;
    if (mountedRef.current && initialSample) {
      setLoading(true);
    }
    if (mountedRef.current) setError((current) => current === undefined ? current : undefined);
    try {
      const payload = await fetcher("/api/v1/mihomo/connections", controller.signal);
      if (!mountedRef.current || sequence !== sequenceRef.current || controller.signal.aborted) return undefined;
      const sampled = sampleProxyGroupTraffic(countersRef.current, payload, now());
      countersRef.current = sampled.counters;
      sampledAtRef.current = sampled.sampledAt;
      hasSampleRef.current = true;
      setTraffic((current) => proxyGroupTrafficEqual(current, sampled.traffic) ? current : sampled.traffic);
      return sampled.traffic;
    } catch (reason) {
      if (!mountedRef.current || sequence !== sequenceRef.current || controller.signal.aborted) return undefined;
      setError(reason instanceof Error ? reason.message : "连接流量加载失败");
      return undefined;
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current && initialSample) setLoading(false);
    }
  }, [enabled, fetcher, now, visible]);

  useEffect(() => {
    if (!enabled || !visible) return undefined;
    void refresh();
    if (intervalMs <= 0) return undefined;
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh, visible]);

  return { traffic, groupTraffic: traffic, counters: countersRef.current, sampledAt: sampledAtRef.current, loading, error, visible, refresh };
}
