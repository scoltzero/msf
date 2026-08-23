"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, Clock3, Database, Eye, EyeOff, Globe2, Maximize2, PauseCircle, PlayCircle, RefreshCw, Route, Trash2, X, Zap } from "lucide-react";
import { formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { aggregateConnections, clearClosedConnections, pruneClosedConnections, readClosedConnections, saveClosedConnections, toClosedConnection, type ClosedConnectionRecord, type HistoryAggregation } from "./connectionHistory";
import { FAVICON_TARGETS, runFaviconRounds, type FaviconSample } from "./telemetry";
import { echarts, ZashboardEChart, type EChartsOption } from "./ZashboardEChart";
import {
  MIHOMO_CONNECTION_AREA_COLOR,
  MIHOMO_CONNECTION_COLOR,
  MIHOMO_DOWNLOAD_AREA_COLOR,
  MIHOMO_DOWNLOAD_COLOR,
  MIHOMO_UPLOAD_AREA_COLOR,
  MIHOMO_UPLOAD_COLOR,
} from "./visualColors";

export type OverviewConnection = Record<string, any>;

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function stringValue(value: unknown, fallback = "-") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function connectionField(row: OverviewConnection, ...keys: string[]) {
  const metadata = objectValue(row.metadata || row.raw?.metadata);
  for (const key of keys) {
    const value = row[key] ?? metadata[key] ?? row.raw?.[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return "-";
}

export function normalizeOverviewConnections(payload: unknown): OverviewConnection[] {
  const data = objectValue(payload);
  const connectionValue = data.connections;
  const source = Array.isArray(payload)
    ? payload
    : arrayValue(Array.isArray(connectionValue) ? connectionValue : objectValue(connectionValue).connections || data.items || data.data);
  return source.filter((row) => row && typeof row === "object").map((row: any) => {
    const metadata = objectValue(row.metadata || row.raw?.metadata);
    const chains = Array.isArray(row.chains) ? row.chains.map(String).filter(Boolean) : [];
    return {
      ...row,
      id: stringValue(row.id, Math.random().toString(36)),
      source: connectionField(row, "source", "source_ip", "sourceIP") || stringValue(metadata.sourceIP),
      target: connectionField(row, "host", "destination", "destination_ip", "destinationIP"),
      process: connectionField(row, "process", "processPath"),
      exit: connectionField(row, "exit", "destination", "destination_ip", "destinationIP"),
      proxyGroup: chains[0] || connectionField(row, "proxyGroup", "chain"),
      chains,
      bytes: numberValue(row.downloadTotalValue ?? row.download_total ?? row.download) + numberValue(row.uploadTotalValue ?? row.upload_total ?? row.upload),
    };
  });
}

function sectionTitle(icon: ReactNode, title: string, subtitle?: string, action?: ReactNode) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div><h2 className="text-sm font-semibold text-foreground">{title}</h2>{subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}</div>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border/55 text-xs text-muted-foreground">{children}</div>;
}

export type OverviewTrafficHistoryPoint = {
  timestamp: number;
  downloadSpeed: number;
  uploadSpeed: number;
  init?: boolean;
};

export type OverviewConnectionHistoryPoint = {
  timestamp: number;
  connections: number;
  init?: boolean;
};

type TimestampedChartPoint = {
  name: string;
  value: [number, number];
  init?: boolean;
};

function formatDecimalBytes(value: number, maximumFractionDigits = 1) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${Number(size.toFixed(size >= 10 ? 0 : maximumFractionDigits))} ${units[unit]}`;
}

function formatBinaryBytes(value: number | string) {
  if (typeof value === "string") return value.replace(/\bMB\b/, "MiB").replace(/\bGB\b/, "GiB");
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${Number(size.toFixed(size >= 10 ? 1 : 2))} ${units[unit]}`;
}

function splitMetric(value: number) {
  const formatted = formatDecimalBytes(value);
  const match = formatted.match(/^([\d.]+)\s*(.*)$/);
  return match ? { value: match[1], unit: match[2] } : { value: formatted, unit: "" };
}

function SparklineChart({
  points,
  name,
  color,
  areaColor,
  yAxisFloor,
  axisFormatter,
  tooltipFormatter,
}: {
  points: TimestampedChartPoint[];
  name: string;
  color: string;
  areaColor: string;
  yAxisFloor: number;
  axisFormatter: (value: number) => string;
  tooltipFormatter: (value: number) => string;
}) {
  const latestTimestamp = points.at(-1)?.value[0] ?? 0;
  const option = useMemo<EChartsOption>(() => {
    const latest = points.at(-1)?.value[0] ?? Date.now();
    const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const labelColor = dark ? "rgba(255,255,255,.55)" : "rgba(35,38,45,.55)";
    return {
      animationDurationUpdate: 1000,
      animationEasingUpdate: "linear",
      grid: { left: 0, top: 0, right: 30, bottom: 0 },
      tooltip: {
        show: true,
        trigger: "axis",
        confine: true,
        backgroundColor: dark ? "rgba(20,20,23,.94)" : "rgba(255,255,255,.96)",
        borderColor: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)",
        padding: [4, 7],
        textStyle: { color: dark ? "#f4f4f5" : "#27272a", fontSize: 11 },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          const pair = item?.value as [number, number] | undefined;
          if (!pair) return "";
          const time = new Date(pair[0]).toLocaleTimeString("zh-CN", { hour12: false });
          return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:5px"></span>${name} (${time}): ${tooltipFormatter(pair[1])}`;
        },
      },
      xAxis: {
        type: "time",
        show: false,
        min: latest - 59_000,
        max: latest - 1_000,
      },
      yAxis: {
        type: "value",
        show: true,
        position: "right",
        splitNumber: 2,
        min: 0,
        max: (value: { max: number }) => Math.max(value.max, yAxisFloor),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          show: true,
          fontSize: 9,
          color: labelColor,
          margin: 4,
          formatter: (value: number) => value === 0 ? "" : axisFormatter(value),
        },
      },
      series: [{
        type: "line",
        name,
        symbol: "none",
        smooth: true,
        lineStyle: { width: 1.5, color },
        data: points,
        emphasis: { disabled: true },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color },
            { offset: 1, color: areaColor },
          ]),
        },
      }],
    };
  }, [areaColor, color, latestTimestamp, name, yAxisFloor]);
  return <div className="relative h-full w-full overflow-hidden"><ZashboardEChart option={option} /></div>;
}

export function OverviewStatCards({ downloadSpeed, uploadSpeed, connections, downloadTotal, uploadTotal, memory, trafficHistory, connectionHistory }: { downloadSpeed: number; uploadSpeed: number; connections: number; downloadTotal: number; uploadTotal: number; memory: number | string; trafficHistory: OverviewTrafficHistoryPoint[]; connectionHistory: OverviewConnectionHistoryPoint[] }) {
  const uploadParts = splitMetric(uploadSpeed);
  const downloadParts = splitMetric(downloadSpeed);
  const cards = [
    { label: "上传", value: uploadParts.value, unit: `${uploadParts.unit}/s`, total: `总计 ${formatBytes(uploadTotal)}`, points: trafficHistory.map((point) => ({ name: String(point.timestamp), value: [point.timestamp, point.uploadSpeed] as [number, number], init: point.init })), color: MIHOMO_UPLOAD_COLOR, areaColor: MIHOMO_UPLOAD_AREA_COLOR, floor: 60_000, axis: (value: number) => `${formatDecimalBytes(value, 0)}/s`, tooltip: (value: number) => `${formatDecimalBytes(value)}/s` },
    { label: "下载", value: downloadParts.value, unit: `${downloadParts.unit}/s`, total: `总计 ${formatBytes(downloadTotal)}`, points: trafficHistory.map((point) => ({ name: String(point.timestamp), value: [point.timestamp, point.downloadSpeed] as [number, number], init: point.init })), color: MIHOMO_DOWNLOAD_COLOR, areaColor: MIHOMO_DOWNLOAD_AREA_COLOR, floor: 60_000, axis: (value: number) => `${formatDecimalBytes(value, 0)}/s`, tooltip: (value: number) => `${formatDecimalBytes(value)}/s` },
    { label: "连接", value: String(connections), unit: "", total: `内存使用 ${formatBinaryBytes(memory)}`, points: connectionHistory.map((point) => ({ name: String(point.timestamp), value: [point.timestamp, point.connections] as [number, number], init: point.init })), color: MIHOMO_CONNECTION_COLOR, areaColor: MIHOMO_CONNECTION_AREA_COLOR, floor: 10, axis: (value: number) => String(Math.round(value)), tooltip: (value: number) => String(Math.round(value)) },
  ];
  return <GlassSurface material="thick" className="@container rounded-2xl p-3"><div className="grid grid-cols-2 gap-3 @min-[768px]:grid-cols-3">{cards.map((card, index) => <SolidPlate tone="regular" key={card.label} className={cn("flex min-w-0 flex-col gap-1.5 p-[15px]", index === 2 && "col-span-2 @min-[768px]:col-span-1")}><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{card.label}{index === 2 ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}</div><div className="flex items-baseline gap-1.5"><span className="text-3xl font-extralight tabular-nums text-foreground">{card.value}</span>{card.unit ? <span className="text-sm text-muted-foreground">{card.unit}</span> : null}</div><div className="mt-1 h-14"><SparklineChart points={card.points} name={card.label} color={card.color} areaColor={card.areaColor} yAxisFloor={card.floor} axisFormatter={card.axis} tooltipFormatter={card.tooltip} /></div><div className="text-xs text-muted-foreground">{card.total}</div></SolidPlate>)}</div></GlassSurface>;
}

interface LatencyState {
  samples: FaviconSample[];
  running: boolean;
}

const LATENCY_ROUNDS = 10;

function latencyColorClass(value: number) {
  if (value < 400) return { bar: "bg-emerald-600/75", text: "text-emerald-600" };
  if (value < 800) return { bar: "bg-amber-500/85", text: "text-amber-600" };
  return { bar: "bg-rose-600/80", text: "text-rose-600" };
}

function LatencyChart({ samples }: { samples: FaviconSample[] }) {
  const ceiling = Math.max(...samples.filter((sample) => sample.ok).map((sample) => sample.elapsedMs), 1);
  return (
    <div className="flex h-8 min-w-0 flex-1 items-end gap-0.5">
      {Array.from({ length: LATENCY_ROUNDS }, (_, index) => {
        const sample = samples[index];
        const height = !sample ? 18 : sample.ok ? Math.max(18, Math.round(sample.elapsedMs / ceiling * 100)) : 100;
        return (
          <span
            key={index}
            title={!sample ? "等待测试" : sample.ok ? `${sample.elapsedMs}ms` : "测试失败"}
            className={cn(
              "min-w-0 flex-1 rounded-[1px] transition-[height,opacity,background-color] duration-300 ease-out hover:opacity-80",
              !sample ? "bg-foreground/10" : sample.ok ? latencyColorClass(sample.elapsedMs).bar : "bg-rose-600/40",
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

function LatencyStats({ samples }: { samples: FaviconSample[] }) {
  const values = samples.filter((sample) => sample.ok).map((sample) => sample.elapsedMs).sort((left, right) => left - right);
  if (values.length === 0) return <span className="text-foreground/30">--</span>;
  const stats = [
    { label: "min", value: values[0] },
    { label: "avg", value: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) },
    { label: "max", value: values.at(-1) ?? 0 },
  ];
  return stats.map((stat) => (
    <span key={stat.label} className="animate-in fade-in duration-300">
      <span className="mr-1 text-foreground/40">{stat.label}</span>
      <span className={latencyColorClass(stat.value).text}>{stat.value}ms</span>
    </span>
  ));
}

export function FaviconLatencyTester() {
  const [state, setState] = useState<LatencyState>({ samples: [], running: false });
  const runningRef = useRef(false);
  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState({ samples: [], running: true });
    try {
      await runFaviconRounds(FAVICON_TARGETS, LATENCY_ROUNDS, (sample) => {
        setState((current) => ({ ...current, samples: [...current.samples, sample] }));
      });
    } finally {
      runningRef.current = false;
      setState((current) => ({ ...current, running: false }));
    }
  };
  const progress = state.samples.length;
  return (
    <SolidPlate tone="subtle" className="flex flex-col rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">延迟</div>
        <button type="button" onClick={() => void run()} disabled={state.running} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60" title="重新测试">
          <Zap className={cn("h-3.5 w-3.5", state.running && "animate-pulse")} />
          <span className="sr-only">{state.running ? `测试中 ${progress}/40` : "重新测试"}</span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        {FAVICON_TARGETS.map((target) => {
          const samples = state.samples.filter((sample) => sample.targetId === target.id);
          return (
            <div key={target.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-14 shrink-0 text-xs text-muted-foreground">{target.label}</span>
                <LatencyChart samples={samples} />
              </div>
              <div className="flex flex-wrap gap-x-4 text-[11px] tabular-nums">
                <LatencyStats samples={samples} />
              </div>
            </div>
          );
        })}
      </div>
    </SolidPlate>
  );
}

function maskIP(value: string) {
  if (!value || value === "-") return "-";
  if (value.includes(":")) return value.split(":").slice(0, 3).join(":") + ":•••";
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.•••.•••` : "•••";
}

export function NetworkInfoPanel({ domestic, international, loading, onRefresh }: { domestic: { ip: string; location: string }; international: { ip: string; location: string }; loading: boolean; onRefresh: () => void }) {
  const [visible, setVisible] = useState(false);
  return <SolidPlate tone="regular" className="h-full p-4">{sectionTitle(<Globe2 className="h-4 w-4" />, "网络信息", "国内与国际出口", <div className="flex gap-1"><button type="button" onClick={() => setVisible((value) => !value)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title={visible ? "隐藏 IP" : "显示 IP"}>{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button><button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60" title="刷新网络信息"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button></div>)}<div className="space-y-3 text-xs"><div><div className="text-muted-foreground">myip.ipip.net · 国内出口</div><div className="mt-0.5 text-foreground">{domestic.location || "-"}</div><div className="font-mono text-muted-foreground">{visible ? domestic.ip : maskIP(domestic.ip)}</div></div><div className="border-t border-border/40 pt-3"><div className="text-muted-foreground">ip.sb · 国际出口</div><div className="mt-0.5 text-foreground">{international.location || "-"}</div><div className="font-mono text-muted-foreground">{visible ? international.ip : maskIP(international.ip)}</div></div></div></SolidPlate>;
}

interface ProviderRow { name: string; used: number; total: number; upload: number; download: number; expire: string; }

export function normalizeProviderTraffic(payload: unknown): ProviderRow[] {
  const data = objectValue(payload);
  const values: any[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) values.push(...value);
    else if (value && typeof value === "object") values.push(...Object.entries(value as Record<string, any>).map(([name, row]) => ({ ...objectValue(row), name: objectValue(row).name || name })));
  };
  collect(data.proxy_providers); collect(data.providers); collect(data.runtime_items); collect(data.items);
  const seen = new Set<string>();
  return values.map((row) => {
    const info = objectValue(row.subscriptionInfo || row.subscription_info || row.runtime?.subscriptionInfo || row.runtime?.subscription_info);
    const upload = numberValue(info.Upload ?? info.upload ?? row.upload);
    const download = numberValue(info.Download ?? info.download ?? row.download);
    const total = numberValue(info.Total ?? info.total ?? row.total);
    return { name: stringValue(row.name), used: upload + download, total, upload, download, expire: stringValue(info.Expire ?? info.expire, "") };
  }).filter((row) => row.name && row.total > 0 && !seen.has(row.name) && seen.add(row.name));
}

export function ProviderTrafficPanel({ payload }: { payload: unknown }) {
  const providers = useMemo(() => normalizeProviderTraffic(payload), [payload]);
  const totals = providers.reduce((sum, row) => ({ used: sum.used + row.used, total: sum.total + row.total }), { used: 0, total: 0 });
  const rows = providers.length > 1 ? [{ name: "全部订阅", used: totals.used, total: totals.total, upload: 0, download: 0, expire: "" }, ...providers] : providers;
  return <GlassSurface material="thick" className="rounded-2xl p-4">{sectionTitle(<Database className="h-4 w-4" />, "订阅流量统计", "已用 / 总量与剩余额度")}{rows.length ? <div className="grid max-h-[32rem] grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-2 overflow-y-auto">{rows.map((provider) => { const percent = Math.min(100, provider.used / provider.total * 100); const remaining = Math.max(0, provider.total - provider.used); return <SolidPlate tone="regular" key={provider.name} className="p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-foreground">{provider.name}</span><span className="text-[10px] tabular-nums text-muted-foreground">{percent.toFixed(1)}%</span></div><div className="mt-2 text-lg font-light tabular-nums text-foreground">{formatBytes(provider.used)} <span className="text-xs text-muted-foreground">/ {formatBytes(provider.total)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${percent}%` }} /></div><div className="mt-1.5 text-[10px] text-muted-foreground">剩余 {formatBytes(remaining)}</div></SolidPlate>; })}</div> : <EmptyState>当前 Provider 没有可用的订阅配额信息</EmptyState>}</GlassSurface>;
}

export interface ConnectionSankeyProps {
  connections: OverviewConnection[];
  size?: "m" | "l";
  editing?: boolean;
  embedded?: boolean;
}

export function buildConnectionTopology(snapshot: OverviewConnection[]) {
  const colors = ["#6a6fc5", "#a8d4a0", "#fddb8a", "#f2a0a0"];
  const nodeIds = new Map<string, number>();
  const nodeNames = new Map<string, string>();
  const nodeLayers = new Map<string, number>();
  const linkCounts = new Map<string, number>();
  let nextNodeId = 0;
  const addNode = (name: string, layer: number) => {
    const key = `${layer}:${name}`;
    if (!nodeIds.has(key)) {
      nodeIds.set(key, nextNodeId++);
      nodeNames.set(key, name);
      nodeLayers.set(key, layer);
    }
    return nodeIds.get(key)!;
  };
  const addLink = (source: number, target: number) => {
    const key = `${source}:${target}`;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  };
  snapshot.forEach((row) => {
    const chains = Array.isArray(row.chains) ? row.chains.map(String).filter(Boolean) : [];
    if (!chains.length) return;
    const source = addNode(stringValue(row.source, "未知"), 0);
    const ruleName = stringValue(row.rulePayload ? `${row.rule}: ${row.rulePayload}` : row.rule, "未知");
    const rule = addNode(ruleName, 1);
    const chainExit = chains[0];
    const chainEntry = chains.at(-1)!;
    addLink(source, rule);
    if (chainEntry === chainExit) {
      addLink(rule, addNode(chainExit, 3));
    } else {
      const entry = addNode(chainEntry, 2);
      const exit = addNode(chainExit, 3);
      addLink(rule, entry);
      addLink(entry, exit);
    }
  });
  const grouped = new Map<number, Array<{ oldId: number; name: string; layer: number }>>();
  nodeIds.forEach((oldId, key) => {
    const layer = nodeLayers.get(key) ?? 0;
    const rows = grouped.get(layer) ?? [];
    rows.push({ oldId, name: nodeNames.get(key) ?? "", layer });
    grouped.set(layer, rows);
  });
  const idMapping = new Map<number, number>();
  const nodes: Array<{ id: number; name: string; depth: number; itemStyle: { color: string } }> = [];
  Array.from(grouped.keys()).sort((a, b) => a - b).forEach((layer) => {
    grouped.get(layer)!.sort((a, b) => a.name.localeCompare(b.name)).forEach((node) => {
      const id = nodes.length;
      idMapping.set(node.oldId, id);
      nodes.push({ id, name: node.name, depth: layer, itemStyle: { color: colors[layer] } });
    });
  });
  const links = Array.from(linkCounts, ([key, originalValue]) => {
    const [oldSource, oldTarget] = key.split(":").map(Number);
    const source = idMapping.get(oldSource);
    const target = idMapping.get(oldTarget);
    if (source == null || target == null || source === target) return null;
    return { source, target, value: Math.log10(originalValue + 1) * 10, originalValue };
  }).filter(Boolean) as Array<{ source: number; target: number; value: number; originalValue: number }>;
  return { nodes, links };
}

export function ConnectionSankey({ connections, size = "l", editing = false, embedded = false }: ConnectionSankeyProps) {
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [snapshot, setSnapshot] = useState(connections);
  const [fullScreen, setFullScreen] = useState(false);
  const paused = manuallyPaused || tooltipVisible || editing;
  useEffect(() => { if (!paused) setSnapshot(connections); }, [connections, paused]);
  useEffect(() => {
    if (!fullScreen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setFullScreen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [fullScreen]);
  const graph = useMemo(() => buildConnectionTopology(snapshot), [snapshot]);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const option = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    textStyle: { color: dark ? "#f4f4f5" : "#27272a" },
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      backgroundColor: dark ? "rgba(20,20,23,.94)" : "rgba(255,255,255,.96)",
      borderColor: dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.08)",
      textStyle: { color: dark ? "#f4f4f5" : "#27272a" },
      formatter: (params: any) => {
        if (params.dataType === "node") return `${params.data.name}<br/>节点类型：${["源 IP", "命中规则", "入口代理组", "出口节点"][params.data.depth] ?? "未知"}`;
        const source = graph.nodes.find((node) => node.id === params.data.source);
        const target = graph.nodes.find((node) => node.id === params.data.target);
        return `${source?.name ?? ""} → ${target?.name ?? ""}<br/>连接数：${params.data.originalValue ?? params.data.value}`;
      },
    },
    series: [{
      id: "sankey",
      type: "sankey",
      layout: "none",
      data: graph.nodes,
      links: graph.links,
      emphasis: { focus: "trajectory" },
      lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.38 },
      itemStyle: { borderWidth: 0 },
      label: {
        color: dark ? "#f4f4f5" : "#27272a",
        fontSize: 12,
        formatter: (params: any) => {
          const limit = fullScreen ? 45 : size === "m" ? 18 : 32;
          return params.name.length > limit ? `${params.name.slice(0, limit)}…` : params.name;
        },
      },
      nodeGap: 4,
      nodeWidth: 15,
      nodeAlign: "left",
      animation: !paused,
      animationDuration: paused ? 0 : 1000,
      animationEasing: "cubicOut",
      animationDelay: (index: number) => index * 50,
    } as any],
  }), [dark, fullScreen, graph, paused, size]);
  const content = <>
    <div className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", embedded && "sr-only")}>连接拓扑</div>
    <SolidPlate tone="subtle" className={cn("relative w-full overflow-hidden rounded-xl", embedded ? "h-full min-h-[280px]" : "mt-4 h-96", fullScreen && "h-[calc(100vh-2rem)] rounded-none")}>
      {graph.nodes.length ? <ZashboardEChart option={option} onTooltipVisibilityChange={setTooltipVisible} /> : <EmptyState>暂无连接拓扑数据</EmptyState>}
      <div className="absolute bottom-1 right-1 flex flex-col gap-1">
        <button type="button" onClick={() => { setManuallyPaused((value) => !value); if (manuallyPaused) setSnapshot(connections); }} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" title={manuallyPaused ? "继续更新" : editing ? "编辑布局时已暂停" : "暂停更新"} disabled={editing}>{manuallyPaused || editing ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}</button>
        <button type="button" onClick={() => setFullScreen((value) => !value)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" title={fullScreen ? "退出全屏" : "全屏查看"}>{fullScreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
      </div>
    </SolidPlate>
  </>;
  const wrapperClass = cn(embedded ? "h-full min-h-0" : "rounded-2xl p-4", fullScreen && "fixed inset-0 z-[120] rounded-none bg-background p-4");
  return embedded ? <div className={wrapperClass}>{content}</div> : <GlassSurface material="thick" className={wrapperClass}>{content}</GlassSurface>;
}

export function ConnectionHistoryPanel({ connections }: { connections: OverviewConnection[] }) {
  const [closed, setClosed] = useState<ClosedConnectionRecord[]>([]);
  const [aggregation, setAggregation] = useState<HistoryAggregation>(() => (localStorage.getItem("msf-mihomo-history-aggregation") as HistoryAggregation) || "source");
  const [cleanupDays, setCleanupDays] = useState(() => Number(localStorage.getItem("msf-mihomo-history-cleanup-days") || 30));
  const previous = useRef<Map<string, OverviewConnection> | null>(null);
  useEffect(() => {
    const current = new Map(connections.map((row) => [String(row.id), row]));
    if (previous.current) {
      const ended = Array.from(previous.current).filter(([id]) => !current.has(id)).map(([, row]) => toClosedConnection(row));
      if (ended.length) void saveClosedConnections(ended).then(() => readClosedConnections().then(setClosed));
    }
    previous.current = current;
  }, [connections]);
  useEffect(() => {
    const cutoff = cleanupDays > 0 ? Date.now() - cleanupDays * 86400000 : 0;
    const load = async () => { if (cutoff) await pruneClosedConnections(cutoff); setClosed(await readClosedConnections()); };
    void load();
  }, [cleanupDays]);
  const active = connections.map((row) => toClosedConnection(row, Date.now()));
  const rows = aggregateConnections([...closed, ...active], aggregation).sort((a, b) => b.download + b.upload - a.download - a.upload);
  const totals = rows.reduce((sum, row) => ({ download: sum.download + row.download, upload: sum.upload + row.upload, count: sum.count + row.count }), { download: 0, upload: 0, count: 0 });
  const labels: Record<HistoryAggregation, string> = { source: "源 IP", target: "目标主机", process: "进程", outbound: "最终出口", proxyGroup: "代理分组" };
  return <GlassSurface material="thick" className="rounded-2xl p-4">{sectionTitle(<Clock3 className="h-4 w-4" />, "连接统计", "仅在连接结束时写入历史，当前活跃连接只参与即时汇总", <div className="flex flex-wrap items-center gap-1.5"><select value={aggregation} onChange={(event) => { const value = event.target.value as HistoryAggregation; setAggregation(value); localStorage.setItem("msf-mihomo-history-aggregation", value); }} className="gary-field h-8 rounded-lg px-2 text-xs">{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={cleanupDays} onChange={(event) => { const value = Number(event.target.value); setCleanupDays(value); localStorage.setItem("msf-mihomo-history-cleanup-days", String(value)); }} className="gary-field h-8 rounded-lg px-2 text-xs"><option value={0}>永不清理</option><option value={7}>保留一周</option><option value={30}>保留一月</option><option value={90}>保留三月</option></select><button type="button" onClick={() => void clearClosedConnections().then(() => setClosed([]))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="清空连接历史"><Trash2 className="h-3.5 w-3.5" /></button></div>)}<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{[[labels[aggregation], rows.length], ["总流量", formatBytes(totals.download + totals.upload)], ["下载", formatBytes(totals.download)], ["上传", formatBytes(totals.upload)], ["连接次数", totals.count]].map(([label, value]) => <SolidPlate tone="regular" key={String(label)} className="p-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-lg font-light tabular-nums text-foreground">{value}</div></SolidPlate>)}</div>{rows.length ? <SolidPlate tone="strong" className="max-h-96 overflow-y-auto rounded-xl"><table className="w-full table-fixed text-xs"><thead className="sticky top-0 z-10 gary-solid-plate--strong"><tr><th className="w-[36%] px-3 py-2 text-left">{labels[aggregation]}</th><th className="px-2 py-2 text-right">下载</th><th className="px-2 py-2 text-right">上传</th><th className="px-2 py-2 text-right">总量</th><th className="px-2 py-2 text-right">次数</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border/30"><td className="truncate px-3 py-2 font-mono" title={row.key}>{row.key}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.download)}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.upload)}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.download + row.upload)}</td><td className="px-2 py-2 text-right tabular-nums">{row.count}</td></tr>)}</tbody></table></SolidPlate> : <EmptyState>等待连接结束后生成历史统计</EmptyState>}</GlassSurface>;
}

function normalizeRuleHits(payload: unknown) {
  const data = objectValue(payload);
  const raw = Array.isArray(payload) ? payload : arrayValue(data.rules || data.items || data.data || data.runtime?.rules);
  return raw.flatMap((row: any, index) => {
    const extra = objectValue(row.extra || row.raw?.extra);
    const hitValue = row.hit_count ?? extra.hitCount ?? extra.hit_count;
    if (hitValue == null || hitValue === "" || !Number.isFinite(Number(hitValue))) return [];
    return [{ name: `${stringValue(row.type, `规则 ${index + 1}`)} · ${stringValue(row.payload, "-")}`, hits: Math.max(0, Number(hitValue)), lastHit: stringValue(row.hit_at ?? extra.hitAt ?? extra.hit_at, "") }];
  }).sort((a, b) => b.hits - a.hits).slice(0, 40);
}

export function RuleHitChart({ payload }: { payload: unknown }) {
  const rules = useMemo(() => normalizeRuleHits(payload), [payload]);
  const maximum = Math.max(1, ...rules.map((rule) => rule.hits));
  return <GlassSurface material="thick" className="rounded-2xl p-4">{sectionTitle(<BarChart3 className="h-4 w-4" />, "规则命中统计", "Mihomo extra.hitCount · 按命中次数降序")}{rules.length ? <SolidPlate tone="subtle" className="p-4"><div className="grid h-72 grid-cols-10 items-end gap-2 sm:grid-cols-16 xl:grid-cols-24">{rules.slice(0, 24).map((rule, index) => <div key={rule.name} className={cn("flex h-full min-w-0 flex-col justify-end", index >= 10 && "hidden sm:flex", index >= 16 && "sm:hidden xl:flex")} title={`${rule.name}${rule.lastHit ? `\n最近命中：${rule.lastHit}` : ""}`}><div className="mb-1 text-center text-[9px] font-medium tabular-nums text-foreground">{rule.hits}</div><div className="mx-auto w-[72%] min-w-2 rounded-t bg-violet-500/55" style={{ height: `${Math.max(2, rule.hits / maximum * 82)}%` }} /><div className="mt-2 h-8 overflow-hidden text-center text-[8px] leading-3 text-muted-foreground">{rule.name.replace(" · ", "\n")}</div></div>)}</div></SolidPlate> : <EmptyState>当前 Mihomo 未提供规则 extra 命中统计</EmptyState>}</GlassSurface>;
}
