"use client";

import { createContext, useContext } from "react";
import type { ChartPoint } from "../charts";

export const SYSTEM_HISTORY_RETENTION_SECONDS = 360;

export type SystemMonitorPoint = ChartPoint & { timestamp: number };

export type DashboardService = {
  key: string;
  name: string;
  configured: boolean;
  running: boolean;
  cpuPercent: number;
  memoryBytes: number;
  memoryLabel?: string;
  uptimeSeconds: number;
  uptimeLabel?: string;
  pid?: number;
  raw: Record<string, unknown>;
};

export type SystemDashboardSnapshot = {
  system: Record<string, any>;
  resources: Record<string, any>;
  network: Record<string, any>;
  services: DashboardService[];
  history: SystemMonitorPoint[];
  loading: boolean;
  error: string;
  streamConnected: boolean;
  lastUpdatedAt: number | null;
};

export type ServiceAction = "start" | "stop" | "restart";

export type SystemDashboardData = SystemDashboardSnapshot & {
  refresh: () => Promise<void>;
  refreshServices: () => Promise<void>;
  runServiceAction: (serviceKey: string, action: ServiceAction) => Promise<void>;
};

export const EMPTY_SYSTEM_DASHBOARD_SNAPSHOT: SystemDashboardSnapshot = {
  system: {},
  resources: {},
  network: {},
  services: [],
  history: [],
  loading: true,
  error: "",
  streamConnected: false,
  lastUpdatedAt: null,
};

export const SystemDashboardDataContext = createContext<SystemDashboardData | null>(null);

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function unwrapApiData(value: unknown): Record<string, any> {
  const source = record(value);
  return record("data" in source ? source.data : source);
}

export function unwrapApiList(value: unknown, keys: string[] = ["services", "data", "items"]): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function finiteNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function pointTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function normalizeSystemMonitorPoint(value: unknown): SystemMonitorPoint | null {
  const outer = record(value);
  const row = record(outer.data && !Array.isArray(outer.data) ? outer.data : outer);
  const network = record(row.network);
  const timestamp = pointTimestamp(row.timestamp ?? row.time ?? row.created_at);
  if (!timestamp) return null;
  return {
    timestamp,
    cpuPercent: finiteNumber(row.cpu_percent ?? row.cpuPercent ?? row.cpu),
    memoryPercent: finiteNumber(row.memory_percent ?? row.memoryPercent ?? row.mem_percent),
    downloadSpeed: finiteNumber(row.download_speed ?? row.downloadSpeed ?? network.download_speed ?? network.downloadSpeed),
    uploadSpeed: finiteNumber(row.upload_speed ?? row.uploadSpeed ?? network.upload_speed ?? network.uploadSpeed),
    connections: finiteNumber(row.connections ?? row.connection_count ?? network.connections ?? network.connection_count),
  };
}

export function mergeSystemHistory(
  previous: SystemMonitorPoint[],
  incoming: Array<SystemMonitorPoint | null>,
  now = Date.now(),
  retentionSeconds = SYSTEM_HISTORY_RETENTION_SECONDS,
): SystemMonitorPoint[] {
  const byTimestamp = new Map<number, SystemMonitorPoint>();
  for (const point of [...previous, ...incoming]) {
    if (point) byTimestamp.set(point.timestamp, point);
  }
  const newestTimestamp = Math.max(now, ...byTimestamp.keys());
  const cutoff = newestTimestamp - retentionSeconds * 1000;
  return Array.from(byTimestamp.values())
    .filter((point) => point.timestamp >= cutoff)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function normalizeDashboardService(value: unknown): DashboardService {
  const raw = record(value);
  const name = String(raw.display_name ?? raw.label ?? raw.name ?? raw.id ?? "service");
  const key = String(raw.name ?? raw.id ?? name).toLowerCase();
  const uptime = raw.uptime_seconds ?? raw.uptime;
  const memory = raw.memory_bytes ?? raw.memory;
  return {
    key,
    name,
    configured: raw.installed !== false && raw.configured !== false,
    running: Boolean(raw.running || raw.status === "running" || raw.active === true),
    cpuPercent: finiteNumber(raw.cpu_percent ?? raw.cpu),
    memoryBytes: typeof memory === "number" ? finiteNumber(memory) : 0,
    memoryLabel: typeof memory === "string" ? memory : undefined,
    uptimeSeconds: typeof uptime === "number" ? finiteNumber(uptime) : 0,
    uptimeLabel: typeof uptime === "string" ? uptime : undefined,
    pid: finiteNumber(raw.pid) || undefined,
    raw,
  };
}

export function parseSseBlocks(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data ? [{ event, data }] : [];
  });
  return { events, rest };
}

export function useSystemDashboardData(): SystemDashboardData {
  const context = useContext(SystemDashboardDataContext);
  if (!context) throw new Error("useSystemDashboardData 必须在 DashboardDataProvider 内使用");
  return context;
}
