"use client";

import { createContext, useContext } from "react";
import type { ClosedConnectionRecord } from "@/components/mihomo/overview/connectionHistory";

export type MihomoTrafficPoint = {
  timestamp: number;
  downloadSpeed: number;
  uploadSpeed: number;
  connections: number;
};

export type MihomoProviderTraffic = {
  name: string;
  used: number;
  total: number;
  upload: number;
  download: number;
  expire: string;
};

export type MihomoRuleHit = { name: string; hits: number; lastHit: string };
export type MihomoConnection = Record<string, any>;

export type MihomoDashboardData = {
  overview: Record<string, any>;
  connections: MihomoConnection[];
  providers: MihomoProviderTraffic[];
  ruleHits: MihomoRuleHit[];
  trafficHistory: MihomoTrafficPoint[];
  closedConnections: ClosedConnectionRecord[];
  trafficConnected: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  clearConnectionHistory: () => Promise<void>;
  applyConnectionRetention: (days: number) => Promise<void>;
};

export const MihomoDashboardDataContext = createContext<MihomoDashboardData | null>(null);

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value: unknown, fallback = "-") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

export function unwrapMihomoData(value: unknown): Record<string, any> {
  const source = objectValue(value);
  return objectValue("data" in source ? source.data : source);
}

export function normalizeMihomoConnections(payload: unknown): MihomoConnection[] {
  const data = objectValue(payload);
  const unwrapped = objectValue(data.data);
  const source = Array.isArray(payload)
    ? payload
    : arrayValue(data.connections ?? data.items ?? (Array.isArray(data.data) ? data.data : unwrapped.connections ?? unwrapped.items));
  return source.filter((row) => row && typeof row === "object").map((value, index) => {
    const row = objectValue(value);
    const metadata = objectValue(row.metadata ?? row.raw?.metadata);
    const chains = Array.isArray(row.chains) ? row.chains.map(String).filter(Boolean) : [];
    const field = (...keys: string[]) => {
      for (const key of keys) {
        const candidate = row[key] ?? metadata[key] ?? row.raw?.[key];
        if (candidate != null && String(candidate).trim()) return String(candidate);
      }
      return "-";
    };
    const sourceValue = field("source", "source_ip", "sourceIP");
    const target = field("host", "destination", "destination_ip", "destinationIP");
    const process = field("process", "processPath");
    return {
      ...row,
      id: stringValue(row.id ?? metadata.id, `${sourceValue}|${target}|${process}|${row.start ?? row.startTime ?? row.createdAt ?? index}`),
      source: sourceValue,
      target,
      process,
      outbound: chains[0] || field("outbound", "proxyGroup", "chain"),
      proxyGroup: chains.at(-1) || field("proxyGroup", "chain"),
      chains,
      download: numberValue(row.download ?? row.downloadTotalValue ?? row.raw?.download),
      upload: numberValue(row.upload ?? row.uploadTotalValue ?? row.raw?.upload),
    };
  });
}

export function normalizeMihomoProviderTraffic(payload: unknown): MihomoProviderTraffic[] {
  const data = unwrapMihomoData(payload);
  const values: any[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) values.push(...value);
    else if (value && typeof value === "object") {
      values.push(...Object.entries(value as Record<string, any>).map(([name, row]) => ({ ...objectValue(row), name: objectValue(row).name || name })));
    }
  };
  collect(data.proxy_providers);
  collect(data.providers);
  collect(data.runtime_items);
  collect(data.items);
  const seen = new Set<string>();
  return values.flatMap((row) => {
    const info = objectValue(row.subscriptionInfo ?? row.subscription_info ?? row.runtime?.subscriptionInfo ?? row.runtime?.subscription_info);
    const name = stringValue(row.name, "");
    const upload = numberValue(info.Upload ?? info.upload ?? row.upload);
    const download = numberValue(info.Download ?? info.download ?? row.download);
    const total = numberValue(info.Total ?? info.total ?? row.total);
    if (!name || total <= 0 || seen.has(name)) return [];
    seen.add(name);
    return [{ name, used: upload + download, total, upload, download, expire: stringValue(info.Expire ?? info.expire, "") }];
  });
}

export function normalizeMihomoRuleHits(payload: unknown): MihomoRuleHit[] {
  const data = unwrapMihomoData(payload);
  const raw = Array.isArray(payload) ? payload : arrayValue(data.rules ?? data.items ?? data.runtime?.rules);
  return raw.flatMap((value, index) => {
    const row = objectValue(value);
    const extra = objectValue(row.extra ?? row.raw?.extra);
    const hitValue = row.hit_count ?? extra.hitCount ?? extra.hit_count;
    if (hitValue === null || hitValue === undefined || hitValue === "") return [];
    const hits = Number(hitValue);
    if (!Number.isFinite(hits)) return [];
    return [{
      name: `${stringValue(row.type, `规则 ${index + 1}`)} · ${stringValue(row.payload)}`,
      hits: Math.max(0, hits),
      lastHit: stringValue(row.hit_at ?? extra.hitAt ?? extra.hit_at, ""),
    }];
  }).sort((left, right) => right.hits - left.hits).slice(0, 100);
}

export function mergeMihomoTrafficHistory(previous: MihomoTrafficPoint[], point: MihomoTrafficPoint, retentionMs = 360_000) {
  const map = new Map(previous.map((sample) => [sample.timestamp, sample]));
  map.set(point.timestamp, point);
  const cutoff = point.timestamp - retentionMs;
  return Array.from(map.values()).filter((sample) => sample.timestamp >= cutoff).sort((a, b) => a.timestamp - b.timestamp);
}

export function useMihomoDashboardData() {
  const context = useContext(MihomoDashboardDataContext);
  if (!context) throw new Error("useMihomoDashboardData 必须在 MihomoDashboardProvider 内使用");
  return context;
}
