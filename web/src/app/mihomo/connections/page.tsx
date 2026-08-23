"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Cable, ChevronRight, ListTree, MapPin, Pause, PinOff, Play, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { ConnectionDetail, type ConnectionRecord } from "@/components/mihomo/ConnectionDetail";
import { ToastStack, useToaster } from "@/components/Toaster";
import { api, apiData, apiList, formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";

type DisplayMode = "auto" | "table" | "card";
type SortKey = "host" | "hostType" | "rule" | "chain" | "down" | "up" | "downloadTotal" | "uploadTotal" | "startTime";
type SortState = { key: SortKey; direction: "asc" | "desc" } | null;
type ConnectionTab = "active" | "closed";

interface ConnectionStats {
  downloadTotal: number;
  uploadTotal: number;
  downloadSpeed: number;
  uploadSpeed: number;
  active: number;
}

interface ConnectionSamples {
  at: number;
  totals: Map<string, { download: number; upload: number }>;
}

const EMPTY_STATS: ConnectionStats = {
  downloadTotal: 0,
  uploadTotal: 0,
  downloadSpeed: 0,
  uploadSpeed: 0,
  active: 0,
};

const DISPLAY_MODE_KEY = "msf-mihomo-connections.display-mode";
const SORT_STATE_KEY = "msf-mihomo-connections.table-sort";
const GROUP_KEY = "msf-mihomo-connections.table-group";
const PIN_HOST_KEY = "msf-mihomo-connections.pin-host";

const COLUMNS: { label: string; minWidth: number; align: "left" | "right" | "center"; sortKey?: SortKey; groupable?: boolean }[] = [
  { label: "", minWidth: 44, align: "center" },
  { label: "目标", minWidth: 250, align: "left", sortKey: "host", groupable: true },
  { label: "主机 / 入站", minWidth: 170, align: "left", sortKey: "hostType", groupable: true },
  { label: "规则", minWidth: 175, align: "left", sortKey: "rule", groupable: true },
  { label: "代理链", minWidth: 230, align: "left", sortKey: "chain", groupable: true },
  { label: "下载速度", minWidth: 104, align: "right", sortKey: "down" },
  { label: "上传速度", minWidth: 104, align: "right", sortKey: "up" },
  { label: "下载量", minWidth: 92, align: "right", sortKey: "downloadTotal" },
  { label: "上传量", minWidth: 92, align: "right", sortKey: "uploadTotal" },
  { label: "连接时间", minWidth: 112, align: "right", sortKey: "startTime" },
];

const SORT_KEYS = new Set<SortKey>(["host", "hostType", "rule", "chain", "down", "up", "downloadTotal", "uploadTotal", "startTime"]);

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function endpoint(host: unknown, port: unknown) {
  const left = stringValue(host);
  const right = stringValue(port);
  if (!left && !right) return "-";
  return right ? `${left}:${right}` : left;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatAgo(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return "-";
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return raw;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function normalizeConnection(row: any, index: number): ConnectionRecord {
  const original = objectValue(row);
  // The backend keeps the exact Mihomo object in raw while also exposing display fields.
  const rawCandidate = objectValue(original.raw);
  const raw = (Object.keys(rawCandidate).length ? rawCandidate : original) as Record<string, unknown>;
  const metadataCandidate = objectValue(original.metadata);
  const metadata = (Object.keys(metadataCandidate).length ? metadataCandidate : objectValue(raw.metadata)) as Record<string, unknown>;
  const read = (...values: unknown[]) => values.map(stringValue).find(Boolean) || "";
  const network = read(original.network, original.protocol, metadata.network, metadata.netWork).toUpperCase();
  const proto = network === "UDP" ? "UDP" : network === "TCP" ? "TCP" : network || "-";
  const source = endpoint(read(original.source_ip, original.sourceIP, metadata.sourceIP, metadata.source_ip), read(original.source_port, original.sourcePort, metadata.sourcePort, metadata.source_port));
  const destination = endpoint(read(original.destination_ip, original.destinationIP, metadata.destinationIP, metadata.destination_ip), read(original.destination_port, original.destinationPort, metadata.destinationPort, metadata.destination_port));
  const host = read(original.host, raw.host, metadata.host, original.process, original.destination_ip, original.destinationIP, destination) || "-";
  const inbound = read(original.inbound, original.type, metadata.type);
  const type = read(original.type, metadata.type);
  const process = read(original.process, metadata.process, metadata.processPath, raw.process);
  const rule = read(original.rule) || "-";
  const rulePayload = read(original.rule_payload, original.rulePayload, raw.rulePayload);
  const chainsRaw = original.chains ?? raw.chains;
  const chains = Array.isArray(chainsRaw) ? chainsRaw.map(stringValue).filter(Boolean) : [];
  const chain = chains.join(" › ") || read(original.chain) || "-";
  const start = read(original.start, raw.start);
  const startTimeValue = Date.parse(start);
  const downloadTotalValue = numberValue(original.download ?? original.download_total ?? original.downloadTotal ?? raw.download);
  const uploadTotalValue = numberValue(original.upload ?? original.upload_total ?? original.uploadTotal ?? raw.upload);
  const downloadSpeedValue = numberValue(original.download_speed ?? original.downloadSpeed);
  const uploadSpeedValue = numberValue(original.upload_speed ?? original.uploadSpeed);
  const match = rulePayload ? `${rule}: ${rulePayload}` : rule;
  return {
    id: read(original.id, raw.id) || `conn-${index + 1}`,
    host,
    proto,
    network: network.toLowerCase(),
    src: source,
    dst: destination,
    inbound: inbound || "-",
    type: type || inbound || "-",
    process: process || "-",
    rule,
    rulePayload,
    match: match || "-",
    chain,
    chains,
    down: `${formatBytes(downloadSpeedValue)}/s`,
    up: `${formatBytes(uploadSpeedValue)}/s`,
    dlTotal: formatBytes(downloadTotalValue),
    ulTotal: formatBytes(uploadTotalValue),
    ago: formatAgo(start),
    dur: Number.isFinite(startTimeValue) ? formatDuration(Date.now() - startTimeValue) : "-",
    start,
    downloadSpeedValue,
    uploadSpeedValue,
    downloadTotalValue,
    uploadTotalValue,
    startTimeValue: Number.isFinite(startTimeValue) ? startTimeValue : 0,
    raw,
    metadata,
  };
}

function normalizeStats(connectionsData: any, trafficData: any, rows: ConnectionRecord[]): ConnectionStats {
  const traffic = objectValue(trafficData);
  const fallbackDownloadSpeed = rows.reduce((total, row) => total + row.downloadSpeedValue, 0);
  const fallbackUploadSpeed = rows.reduce((total, row) => total + row.uploadSpeedValue, 0);
  return {
    downloadTotal: numberValue(connectionsData.download_total ?? connectionsData.downloadTotal),
    uploadTotal: numberValue(connectionsData.upload_total ?? connectionsData.uploadTotal),
    downloadSpeed: numberValue(traffic.down ?? traffic.download ?? traffic.download_speed ?? traffic.downloadSpeed) || fallbackDownloadSpeed,
    uploadSpeed: numberValue(traffic.up ?? traffic.upload ?? traffic.upload_speed ?? traffic.uploadSpeed) || fallbackUploadSpeed,
    active: numberValue(connectionsData.active_count ?? connectionsData.total ?? rows.length),
  };
}

function matchBadgeCls(match: string) {
  return match.startsWith("RuleSet")
    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20"
    : "bg-slate-500/10 text-slate-700 dark:text-slate-200 ring-1 ring-slate-500/20";
}

function connectionColumnValue(connection: ConnectionRecord, key: SortKey): string | number {
  if (key === "host") return `${connection.host} ${connection.src} ${connection.dst}`.toLowerCase();
  if (key === "hostType") return `${connection.process} ${connection.inbound} ${connection.type}`.toLowerCase();
  if (key === "rule") return connection.match.toLowerCase();
  if (key === "chain") return connection.chain.toLowerCase();
  if (key === "down") return connection.downloadSpeedValue;
  if (key === "up") return connection.uploadSpeedValue;
  if (key === "downloadTotal") return connection.downloadTotalValue;
  if (key === "uploadTotal") return connection.uploadTotalValue;
  return connection.startTimeValue;
}

function connectionColumnText(connection: ConnectionRecord, key: SortKey) {
  if (key === "down") return connection.down;
  if (key === "up") return connection.up;
  if (key === "downloadTotal") return connection.dlTotal;
  if (key === "uploadTotal") return connection.ulTotal;
  if (key === "startTime") return `${connection.ago} ${connection.dur} ${connection.start}`;
  return String(connectionColumnValue(connection, key));
}

function connectionGroupLabel(connection: ConnectionRecord, key: SortKey) {
  if (key === "host") return connection.host || "-";
  if (key === "hostType") return connection.type || connection.inbound || connection.process || "-";
  if (key === "rule") return connection.match || "-";
  if (key === "chain") return connection.chain || "-";
  return connectionColumnText(connection, key) || "-";
}

function readSortState(): SortState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SORT_STATE_KEY) || "null") as Partial<NonNullable<SortState>> | null;
    if (parsed && SORT_KEYS.has(parsed.key as SortKey) && (parsed.direction === "asc" || parsed.direction === "desc")) {
      return { key: parsed.key as SortKey, direction: parsed.direction };
    }
  } catch {
    // Fall through to the familiar newest-first default.
  }
  return { key: "startTime", direction: "desc" };
}

function readGroupKey(): SortKey | null {
  try {
    const stored = window.localStorage.getItem(GROUP_KEY) as SortKey | null;
    return stored && SORT_KEYS.has(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readPinnedHost() {
  try {
    return window.localStorage.getItem(PIN_HOST_KEY) === "true";
  } catch {
    return false;
  }
}

function ConnectionTableHeader({
  sortState,
  onSort,
  groupKey,
  onGroup,
  pinnedHost,
  onPinHost,
}: {
  sortState: SortState;
  onSort: (key: SortKey) => void;
  groupKey: SortKey | null;
  onGroup: (key: SortKey) => void;
  pinnedHost: boolean;
  onPinHost: () => void;
}) {
  return (
    <thead className="sticky top-0 z-30">
      <tr className="border-b border-border/55">
        {COLUMNS.map((column, index) => {
          const key = column.sortKey;
          const isPinned = key === "host" && pinnedHost;
          return (
            <th
              key={index}
              style={{ minWidth: column.minWidth }}
              className={cn(
                "sticky top-0 z-30 h-10 bg-card/95 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--border)_55%,transparent)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/82",
                index === 0 && "rounded-tl-xl",
                index === COLUMNS.length - 1 && "rounded-tr-xl",
                column.align === "right" && "text-right",
                column.align === "center" && "text-center",
                isPinned && "left-0 z-50 bg-card shadow-[4px_0_10px_-8px_rgba(0,0,0,.45),inset_0_-1px_0_color-mix(in_oklab,var(--border)_55%,transparent)]",
              )}
            >
              {key ? (
                <div className={cn("relative flex items-center gap-0.5", column.align === "right" && "justify-end")}>
                  <button
                    type="button"
                    onClick={() => onSort(key)}
                    className="inline-flex min-h-7 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                    title="点击切换：升序、降序、不排序"
                    aria-label={`${column.label}排序`}
                  >
                    <span className="truncate">{column.label}</span>
                    {sortState?.key === key ? (sortState.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />) : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-45" />}
                  </button>
                  {column.groupable ? (
                    <button
                      type="button"
                      onClick={() => onGroup(key)}
                      className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45", groupKey === key && "bg-primary/10 text-primary")}
                      title={groupKey === key ? `取消按${column.label}分组` : `按${column.label}分组（Zashboard 放大镜 ± 功能）`}
                      aria-label={groupKey === key ? `取消按${column.label}分组` : `按${column.label}分组`}
                    >
                      <ListTree className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {key === "host" ? (
                    <button
                      type="button"
                      onClick={onPinHost}
                      className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45", pinnedHost && "bg-primary/10 text-primary")}
                      title={pinnedHost ? "取消固定目标列" : "将目标列固定在左侧"}
                      aria-label={pinnedHost ? "取消固定目标列" : "固定目标列"}
                    >
                      {pinnedHost ? <PinOff className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              ) : <span aria-hidden="true" />}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function readDisplayMode(): DisplayMode {
  try {
    const stored = window.localStorage.getItem(DISPLAY_MODE_KEY);
    return stored === "table" || stored === "card" || stored === "auto" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function ModeControl({ value, onChange }: { value: DisplayMode; onChange: (mode: DisplayMode) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/50 bg-muted/45 p-0.5" role="radiogroup" aria-label="连接显示模式">
      {(["auto", "table", "card"] as DisplayMode[]).map((mode) => {
        const label = mode === "auto" ? "自动" : mode === "table" ? "表格" : "卡片";
        return <button key={mode} type="button" role="radio" aria-checked={value === mode} onClick={() => onChange(mode)} className={cn("rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50", value === mode ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>;
      })}
    </div>
  );
}

export default function MihomoConnectionsPage() {
  const { toasts, showToast } = useToaster();
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [stats, setStats] = useState<ConnectionStats>(EMPTY_STATS);
  const [closedCount, setClosedCount] = useState(0);
  const [tab, setTab] = useState<ConnectionTab>("active");
  const [proto, setProto] = useState("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [sortState, setSortState] = useState<SortState>(() => typeof window === "undefined" ? { key: "startTime", direction: "desc" } : readSortState());
  const [groupKey, setGroupKey] = useState<SortKey | null>(() => typeof window === "undefined" ? null : readGroupKey());
  const [pinnedHost, setPinnedHost] = useState(() => typeof window === "undefined" ? false : readPinnedHost());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => typeof window === "undefined" ? "auto" : readDisplayMode());
  const [narrowViewport, setNarrowViewport] = useState(false);
  const [selected, setSelected] = useState<{ id: string; snapshot: ConnectionRecord; ended: boolean } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const connectionSamplesRef = useRef<ConnectionSamples | null>(null);
  const loadInFlightRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(DISPLAY_MODE_KEY, displayMode);
    } catch {
      // Ignore storage failures while preserving the current in-memory choice.
    }
  }, [displayMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_STATE_KEY, JSON.stringify(sortState));
    } catch {
      // Ignore storage failures; the current table state remains usable.
    }
  }, [sortState]);

  useEffect(() => {
    try {
      if (groupKey) window.localStorage.setItem(GROUP_KEY, groupKey);
      else window.localStorage.removeItem(GROUP_KEY);
    } catch {
      // Ignore storage failures.
    }
    setCollapsedGroups(new Set());
  }, [groupKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PIN_HOST_KEY, String(pinnedHost));
    } catch {
      // Ignore storage failures.
    }
  }, [pinnedHost]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => setNarrowViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") media.addEventListener("change", sync);
    else media.addListener?.(sync);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", sync);
      else media.removeListener?.(sync);
    };
  }, []);

  const cardView = displayMode === "card" || (displayMode === "auto" && narrowViewport);

  const updateSelected = useCallback((rows: ConnectionRecord[]) => {
    setSelected((current) => {
      if (!current) return current;
      const next = rows.find((row) => row.id === current.id);
      return next ? { id: current.id, snapshot: next, ended: false } : { ...current, ended: true };
    });
  }, []);

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setLoading(true);
    try {
      const [connectionsPayload, trafficPayload] = await Promise.all([
        api<any>("/api/v1/mihomo/connections?limit=500"),
        api<any>("/api/v1/mihomo/traffic").catch(() => null),
      ]);
      const data = apiData<any>(connectionsPayload, connectionsPayload);
      const traffic = trafficPayload ? apiData<any>(trafficPayload, trafficPayload) : {};
      const now = Date.now();
      const previous = connectionSamplesRef.current;
      const elapsedSeconds = previous ? (now - previous.at) / 1000 : 0;
      const rows = apiList<any>(data, ["connections", "items", "data"]).map(normalizeConnection).map((row) => {
        const sample = previous?.totals.get(row.id);
        if (!sample || elapsedSeconds <= 0) return row;
        const downloadSpeedValue = Math.max(0, (row.downloadTotalValue - sample.download) / elapsedSeconds);
        const uploadSpeedValue = Math.max(0, (row.uploadTotalValue - sample.upload) / elapsedSeconds);
        return {
          ...row,
          downloadSpeedValue,
          uploadSpeedValue,
          down: `${formatBytes(downloadSpeedValue)}/s`,
          up: `${formatBytes(uploadSpeedValue)}/s`,
        };
      });
      connectionSamplesRef.current = {
        at: now,
        totals: new Map(rows.map((row) => [row.id, { download: row.downloadTotalValue, upload: row.uploadTotalValue }])),
      };
      setConnections(rows);
      setStats(normalizeStats(data, traffic, rows));
      setError("");
      updateSelected(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载连接失败";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, [showToast, updateSelected]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [load, paused]);

  const filtered = useMemo(() => {
    let list = tab === "active" ? connections : [];
    if (proto !== "all") list = list.filter((connection) => connection.proto === proto);
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      list = list.filter((connection) => terms.every((term) => [connection.host, connection.chain, connection.match, connection.dst, connection.src, connection.process].join(" ").toLowerCase().includes(term)));
    }
    if (!sortState) return [...list];
    return [...list].sort((left, right) => {
      const a = connectionColumnValue(left, sortState.key);
      const b = connectionColumnValue(right, sortState.key);
      const result = typeof a === "string" ? a.localeCompare(String(b), "zh") : a - Number(b);
      return sortState.direction === "asc" ? result : -result;
    });
  }, [connections, proto, query, sortState, tab]);

  const toggleSort = (nextKey: SortKey) => {
    setSortState((current) => {
      const textFirst = nextKey === "host" || nextKey === "hostType" || nextKey === "rule" || nextKey === "chain";
      const firstDirection = textFirst ? "asc" : "desc";
      if (current?.key !== nextKey) {
        return { key: nextKey, direction: firstDirection };
      }
      if (current.direction === firstDirection) return { key: nextKey, direction: firstDirection === "asc" ? "desc" : "asc" };
      return null;
    });
  };

  const tableGroups = useMemo(() => {
    if (!groupKey) return [{ label: "", connections: filtered }];
    const groups = new Map<string, ConnectionRecord[]>();
    for (const connection of filtered) {
      const label = connectionGroupLabel(connection, groupKey);
      const rows = groups.get(label) || [];
      rows.push(connection);
      groups.set(label, rows);
    }
    return Array.from(groups, ([label, groupedConnections]) => ({ label, connections: groupedConnections }));
  }, [filtered, groupKey]);

  const toggleGroup = (key: SortKey) => setGroupKey((current) => current === key ? null : key);
  const toggleCollapsedGroup = (label: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    return next;
  });

  const closeOne = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await api(`/api/v1/mihomo/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
      setClosedCount((count) => count + 1);
      showToast("连接已关闭");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "关闭连接失败");
      throw err;
    } finally {
      setBusy("");
    }
  }, [load, showToast]);

  const closeAll = async () => {
    setBusy("all");
    try {
      await api("/api/v1/mihomo/connections", { method: "DELETE" });
      setClosedCount((count) => count + connections.length);
      showToast("已关闭所有活跃连接");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "关闭连接失败");
    } finally {
      setBusy("");
    }
  };

  const openDetail = (connection: ConnectionRecord) => {
    setSelected({ id: connection.id, snapshot: connection, ended: false });
  };

  const onRowKeyDown = (event: React.KeyboardEvent, connection: ConnectionRecord) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(connection);
    }
  };

  const tiles = [
    ["下载总量", formatBytes(stats.downloadTotal)],
    ["上传总量", formatBytes(stats.uploadTotal)],
    ["下载速度", `${formatBytes(stats.downloadSpeed)}/s`],
    ["上传速度", `${formatBytes(stats.uploadSpeed)}/s`],
  ];

  return (
    <AppShell fillViewport>
      <div className="flex h-full min-h-0 flex-col gap-3 animate-fade-in">
        <WorkbenchHeader
          icon={Cable}
          title="连接管理"
          description={<><span className="font-semibold text-foreground">{stats.active || connections.length}</span> 活跃 · <span className="font-semibold text-foreground">{closedCount}</span> 已关闭</>}
          actions={(
            <>
                <button type="button" onClick={() => void load().then(() => showToast("已刷新"))} className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="刷新"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></button>
                <button type="button" onClick={() => { setPaused((value) => !value); showToast(paused ? "已恢复刷新" : "已暂停刷新"); }} className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label={paused ? "继续" : "暂停"}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>
                <button type="button" onClick={() => searchInputRef.current?.focus()} className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="过滤"><SlidersHorizontal className="h-4 w-4" /></button>
                <button type="button" disabled={busy === "all" || connections.length === 0} onClick={() => void closeAll()} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-destructive px-2.5 text-xs font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-60"><X className="h-4 w-4" /><span className="hidden xl:inline">关闭所有活跃连接</span><span className="xl:hidden">全部关闭</span></button>
            </>
          )}
          summary={(
            <div className="space-y-2">
              <div className="grid w-full min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                {tiles.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-muted/35 px-2.5 py-1.5 ring-1 ring-border/35"><div className="truncate text-[10px] leading-3.5 text-muted-foreground">{label}</div><div className="truncate text-[13px] font-bold leading-4.5 tabular-nums text-foreground">{value}</div></div>)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="连接状态">
                <button type="button" role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow]", tab === "active" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>活跃 ({connections.length})</button>
                <button type="button" role="tab" aria-selected={tab === "closed"} onClick={() => setTab("closed")} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow]", tab === "closed" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>已关闭 ({closedCount})</button>
              </div>
              <select value={proto} onChange={(event) => setProto(event.target.value)} className="h-8 rounded-lg border border-border/60 bg-card px-2.5 text-xs focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label="协议筛选"><option value="all">all</option><option value="TCP">TCP</option><option value="UDP">UDP</option></select>
              <div className="relative min-w-[200px] flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索｜多个关键词用空格分隔" className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-3 text-xs transition-[border-color,box-shadow] focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20" /></div>
              <ModeControl value={displayMode} onChange={setDisplayMode} />
              </div>
            </div>
          )}
        />

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/50 bg-card">
          <div className="scrollbar-x-only h-full overflow-auto [scrollbar-gutter:auto]">
          {error && connections.length > 0 ? <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span className="truncate">{error}</span><button type="button" onClick={() => void load()} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-destructive/25 px-2 hover:bg-destructive/10"><RefreshCw className="h-3 w-3" />重试</button></div> : null}
          {error && connections.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-sm text-destructive"><div>{error}</div><button type="button" onClick={() => void load()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/10"><RefreshCw className="h-3.5 w-3.5" />重试</button></div> : cardView ? (
            <div className="grid grid-cols-1 gap-2 p-2">
              {filtered.length === 0 ? <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{loading ? "正在加载连接..." : tab === "closed" ? "暂无已关闭连接" : "暂无连接"}</div> : null}
              {filtered.map((connection) => (
                <article key={connection.id} role="button" tabIndex={0} onClick={() => openDetail(connection)} onKeyDown={(event) => onRowKeyDown(event, connection)} className="cursor-pointer rounded-lg border border-border/45 bg-muted/20 p-2.5 transition-colors hover:border-primary/35 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[13px] font-semibold leading-4 text-foreground">{connection.host}</span><span className="shrink-0 rounded-full bg-sky-500/12 px-1.5 py-0.5 text-[9px] font-semibold leading-3 text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300">{connection.proto}</span></div><div className="mt-0.5 truncate font-mono text-[10px] leading-3.5 text-muted-foreground">{connection.src} → {connection.dst}</div></div>
                    <div className="shrink-0 text-right"><div className="text-[11px] tabular-nums text-foreground">{connection.ago}</div><div className="text-[9px] tabular-nums text-muted-foreground">{connection.dur}</div></div>
                    <button type="button" disabled={busy === connection.id} onClick={(event) => { event.stopPropagation(); void closeOne(connection.id); }} onKeyDown={(event) => event.stopPropagation()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-60" title="关闭连接" aria-label="关闭连接"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border/35 pt-2"><div className="min-w-0"><div className="truncate text-[10px] text-muted-foreground" title={connection.match}>{connection.match}</div><div className="truncate text-[11px] text-foreground" title={connection.chain}>{connection.chain}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{connection.type || connection.inbound}</div></div><div className="text-right"><div className="text-[10px] text-muted-foreground">下载</div><div className="text-[11px] font-semibold tabular-nums text-foreground">{connection.down}</div><div className="text-[10px] text-muted-foreground">{connection.dlTotal}</div></div><div className="text-right"><div className="text-[10px] text-muted-foreground">上传</div><div className="text-[11px] font-semibold tabular-nums text-foreground">{connection.up}</div><div className="text-[10px] text-muted-foreground">{connection.ulTotal}</div></div></div>
                </article>
              ))}
            </div>
          ) : (
            <table className="w-full min-w-[1400px] border-separate border-spacing-0">
              <ConnectionTableHeader
                sortState={sortState}
                onSort={toggleSort}
                groupKey={groupKey}
                onGroup={toggleGroup}
                pinnedHost={pinnedHost}
                onPinHost={() => setPinnedHost((current) => !current)}
              />
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-muted-foreground">{loading ? "正在加载连接..." : tab === "closed" ? "暂无已关闭连接" : "暂无连接"}</td></tr> : null}
                {tableGroups.map((group) => (
                  <Fragment key={groupKey ? group.label : "all-connections"}>
                    {groupKey ? (
                      <tr className="bg-muted/45">
                        <td colSpan={COLUMNS.length} className="border-b border-border/30 p-0">
                          <button type="button" onClick={() => toggleCollapsedGroup(group.label)} className="flex h-9 w-full items-center gap-2 px-3 text-left text-[11px] font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45">
                            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !collapsedGroups.has(group.label) && "rotate-90")} />
                            <span className="truncate">{group.label}</span>
                            <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">{group.connections.length}</span>
                          </button>
                        </td>
                      </tr>
                    ) : null}
                    {!collapsedGroups.has(group.label) ? group.connections.map((connection) => (
                      <tr key={connection.id} role="button" tabIndex={0} onClick={() => openDetail(connection)} onKeyDown={(event) => onRowKeyDown(event, connection)} className="group/row cursor-pointer transition-colors hover:bg-muted/30 focus-visible:bg-primary/5 focus-visible:outline-none [&>td]:border-b [&>td]:border-border/20">
                        <td className="px-2.5 py-1 text-center"><button type="button" disabled={busy === connection.id} onClick={(event) => { event.stopPropagation(); void closeOne(connection.id); }} onKeyDown={(event) => event.stopPropagation()} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-60" title="关闭连接" aria-label="关闭连接"><X className="h-3.5 w-3.5" /></button></td>
                        <td className={cn("px-2.5 py-1 transition-colors", pinnedHost && "sticky left-0 z-20 bg-card shadow-[4px_0_10px_-8px_rgba(0,0,0,.4)] group-hover/row:bg-muted")}><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-[12px] font-medium leading-4">{connection.host}</span><span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold leading-3 text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300">{connection.proto}</span></div><div className="truncate font-mono text-[9px] leading-3 text-muted-foreground">{connection.src} → {connection.dst}</div></div></td>
                        <td className="px-2.5 py-1"><div className="min-w-0"><div className="truncate text-[11px] text-foreground" title={connection.process}>{connection.process || "-"}</div><div className="truncate text-[10px] text-muted-foreground" title={connection.inbound}>{connection.inbound || connection.type || "-"}</div></div></td>
                        <td className="px-2.5 py-1"><span className={cn("inline-flex max-w-[200px] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium", matchBadgeCls(connection.match))} title={connection.match}>{connection.match}</span></td>
                        <td className="px-2.5 py-1"><span className="block max-w-[260px] truncate text-[11px]" title={connection.chain}>{connection.chain}</span></td>
                        <td className="px-2.5 py-1 text-right"><span className="text-[11px] tabular-nums">{connection.down}</span></td>
                        <td className="px-2.5 py-1 text-right"><span className="text-[11px] tabular-nums">{connection.up}</span></td>
                        <td className="px-2.5 py-1 text-right"><span className="text-[11px] tabular-nums">{connection.dlTotal}</span></td>
                        <td className="px-2.5 py-1 text-right"><span className="text-[11px] tabular-nums">{connection.ulTotal}</span></td>
                        <td className="px-2.5 py-1 text-right"><div className="text-right"><div className="text-[11px] tabular-nums">{connection.ago}</div><div className="text-[9px] leading-3 tabular-nums text-muted-foreground">{connection.dur}</div></div></td>
                      </tr>
                    )) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </div>
      <ToastStack toasts={toasts} />
      {selected ? <ConnectionDetail connection={selected.snapshot} ended={selected.ended} activeConnections={connections} onCloseConnection={closeOne} onRefreshConnections={load} onDismiss={() => setSelected(null)} showToast={showToast} /> : null}
    </AppShell>
  );
}
