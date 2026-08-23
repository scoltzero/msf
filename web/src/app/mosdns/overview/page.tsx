"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Split,
  Globe,
  Clock,
  Users,
  Database,
  Cpu,
  MemoryStick,
  Timer,
  Layers,
  MapPin,
  Server,
  ChartColumn,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";
import { apiData, apiList, formatBytes, formatPercent } from "@/lib/api";
import { useApiPath } from "@/lib/use-api";
import { EChartCanvas, echarts, type EChartsOption } from "@/components/charts/EChartCanvas";
import { TimeWindowSelector } from "@/components/charts/TimeWindowSelector";
import { timestampMs, type TimeWindowSeconds } from "@/components/charts/timeSeries";
import { namedTimeValue, nextStableScale, type StableScaleState } from "@/components/charts/chartStability";

interface RuleRow {
  name: string;
  key: string;
  count: string;
  pct: number;
  color: string;
}

interface RankRow {
  name: string;
  value: string;
  pct?: number;
  barPct: number;
  danger?: boolean;
}

interface UpstreamRow {
  type: string;
  name: string;
  address: string;
  avgMs: string;
  requests: string;
  adoptRate: string;
  errorRate: string;
}

interface CacheCard {
  title: string;
  total: string;
  hits: string;
  staleHits: string;
  misses: string;
  hitRate: number;
  staleRate: number;
  entries: string;
}

interface Metric {
  label: string;
  value: string;
  sub: string;
  color: string;
  icon: "cpu" | "memory" | "activity" | "timer";
}

function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <GlassSurface
      material="thick"
      className={cn(
        "flex min-h-0 flex-col text-card-foreground",
        className
      )}
    >
      {children}
    </GlassSurface>
  );
}

function CardHeader({
  icon: Icon,
  iconColor,
  title,
  right,
}: {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-border/50">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", iconColor)} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {right}
    </div>
  );
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function percentValue(value: unknown) {
  const numeric = numberValue(value);
  if (numeric > 0 && numeric <= 1) return numeric * 100;
  return numeric;
}

function formatCount(value: unknown) {
  return Math.round(numberValue(value)).toLocaleString();
}

function formatMs(value: unknown) {
  return `${numberValue(value).toFixed(2)} ms`;
}

function usePageVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function entryTimeMs(entry: any, index: number, total: number, fallbackNow = Date.now()) {
  const parsed = timestampMs(entry.query_time ?? entry.time ?? entry.timestamp ?? entry.created_at ?? entry.datetime);
  if (parsed > 0) return parsed;
  return fallbackNow - Math.max(0, total - index - 1) * 1000;
}

function optionalNumber(...values: unknown[]) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function formatTooltipTime(value: unknown) {
  const date = new Date(timestampMs(value) || Date.now());
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface QueryTrendBucket {
  timestamp: number;
  queries: number;
  durationMs: number;
}

export interface QueryTrendData {
  buckets: QueryTrendBucket[];
}

export function makeTrend(entries: any[], windowSeconds: number, now = Date.now()): QueryTrendData {
  const bucketMs = 1000;
  const bucketCount = Math.max(10, Math.round(windowSeconds));
  const finalizedEnd = Math.floor(now / bucketMs) * bucketMs;
  const start = finalizedEnd - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    timestamp: start + (index + 1) * bucketMs,
    queries: 0,
    durationTotal: 0,
    durationCount: 0,
  }));
  const normalized = entries
    .map((entry, index) => ({
      timestamp: entryTimeMs(entry, index, entries.length, now),
      durationMs: optionalNumber(entry.duration_ms, entry.elapsed_ms, entry.cost_ms, entry.ms, entry.duration, entry.latency_ms),
    }))
    .filter((point) => point.timestamp >= start && point.timestamp < finalizedEnd)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-250);

  normalized.forEach((point) => {
    const index = Math.floor((point.timestamp - start) / bucketMs);
    if (index < 0 || index >= bucketCount) return;
    const bucket = buckets[index];
    bucket.queries += 1;
    if (point.durationMs != null) {
      bucket.durationTotal += point.durationMs;
      bucket.durationCount += 1;
    }
  });

  const resultBuckets = buckets.map((bucket) => ({
    timestamp: bucket.timestamp,
    queries: bucket.queries,
    durationMs: bucket.durationCount > 0 ? bucket.durationTotal / bucket.durationCount : 0,
  }));
  return { buckets: resultBuckets };
}

export function freezeTrend(previous: QueryTrendData | undefined, incoming: QueryTrendData): QueryTrendData {
  if (!previous || incoming.buckets.length === 0) return incoming;
  const first = incoming.buckets[0].timestamp;
  const last = incoming.buckets[incoming.buckets.length - 1].timestamp;
  const frozen = new Map(incoming.buckets.map((bucket) => [bucket.timestamp, bucket]));
  for (const bucket of previous.buckets) {
    if (bucket.timestamp >= first && bucket.timestamp <= last) frozen.set(bucket.timestamp, bucket);
  }
  return { buckets: Array.from(frozen.values()).sort((left, right) => left.timestamp - right.timestamp) };
}

function QueryTrendChart({ trend, windowSeconds }: { trend: QueryTrendData; windowSeconds: number }) {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const latest = trend.buckets.at(-1)?.timestamp ?? Date.now();
  const scaleKey = latest;
  const queryScaleRef = useRef<{ range: number; key: number; state?: StableScaleState }>({ range: windowSeconds, key: 0 });
  const durationScaleRef = useRef<{ range: number; key: number; state?: StableScaleState }>({ range: windowSeconds, key: 0 });
  if (queryScaleRef.current.range !== windowSeconds) queryScaleRef.current = { range: windowSeconds, key: 0 };
  if (durationScaleRef.current.range !== windowSeconds) durationScaleRef.current = { range: windowSeconds, key: 0 };
  if (queryScaleRef.current.key !== scaleKey || !queryScaleRef.current.state) {
    queryScaleRef.current.key = scaleKey;
    queryScaleRef.current.state = nextStableScale(
      queryScaleRef.current.state,
      Math.max(...trend.buckets.map((bucket) => bucket.queries), 0),
      1,
    );
  }
  if (durationScaleRef.current.key !== scaleKey || !durationScaleRef.current.state) {
    durationScaleRef.current.key = scaleKey;
    durationScaleRef.current.state = nextStableScale(
      durationScaleRef.current.state,
      Math.max(...trend.buckets.map((bucket) => bucket.durationMs), 0),
      1,
    );
  }
  const maxQueries = queryScaleRef.current.state.ceiling;
  const maxDuration = durationScaleRef.current.state.ceiling;
  const option = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    animationDuration: reducedMotion ? 0 : 260,
    animationDurationUpdate: reducedMotion ? 0 : 220,
    animationEasingUpdate: "cubicOut",
    grid: { left: 46, top: 18, right: 48, bottom: 28 },
    tooltip: {
      show: true,
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line", lineStyle: { color: "oklch(70% 0.03 250)", width: 1.2, type: "dashed" } },
      backgroundColor: dark ? "rgba(20,20,23,.94)" : "rgba(255,255,255,.96)",
      borderColor: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)",
      padding: [8, 10],
      textStyle: { color: dark ? "#f4f4f5" : "#27272a", fontSize: 11 },
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        const values = new Map(rows.map((row: any) => [row.seriesName, Number(row.value?.[1] || 0)]));
        return `<div style="font-weight:600;margin-bottom:6px">${formatTooltipTime(rows[0]?.value?.[0])}</div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:oklch(60% 0.21 235)">新增查询</span><b>${Math.round(values.get("新增查询") ?? 0)}</b></div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:oklch(60% 0.17 152)">当前耗时</span><b>${(values.get("当前耗时") ?? 0).toFixed(2)} ms</b></div>`;
      },
    },
    xAxis: {
      type: "time",
      show: true,
      min: latest - windowSeconds * 1000,
      max: latest,
      splitNumber: 4,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: dark ? "rgba(255,255,255,.12)" : "rgba(35,38,45,.12)" } },
      axisLabel: { color: dark ? "rgba(244,244,245,.58)" : "rgba(39,39,42,.58)", fontSize: 10, hideOverlap: true },
    },
    yAxis: [
      {
        type: "value", show: true, name: "查询数", min: 0, max: maxQueries, splitNumber: 4,
        nameTextStyle: { color: dark ? "rgba(244,244,245,.58)" : "rgba(39,39,42,.58)", fontSize: 10, padding: [0, 0, 0, -4] },
        axisLabel: { color: dark ? "rgba(244,244,245,.58)" : "rgba(39,39,42,.58)", fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false },
        splitLine: { show: true, lineStyle: { color: dark ? "rgba(255,255,255,.06)" : "rgba(35,38,45,.06)", width: 0.5 } },
      },
      {
        type: "value", show: true, name: "ms", min: 0, max: maxDuration, splitNumber: 4,
        nameTextStyle: { color: dark ? "rgba(244,244,245,.58)" : "rgba(39,39,42,.58)", fontSize: 10 },
        axisLabel: { color: dark ? "rgba(244,244,245,.58)" : "rgba(39,39,42,.58)", fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false },
      },
    ],
    series: [
      {
        id: "query-duration", type: "line", name: "当前耗时", yAxisIndex: 1, symbol: "none", smooth: 0.2, showSymbol: false,
        lineStyle: { width: 2.5, color: "oklch(60% 0.17 152)", cap: "round", join: "round" },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "oklch(60% 0.17 152 / .18)" }, { offset: 1, color: "oklch(60% 0.17 152 / .02)" }]) },
        data: trend.buckets.map((bucket) => namedTimeValue(bucket.timestamp, bucket.durationMs)), emphasis: { disabled: true },
      },
      {
        id: "query-count", type: "line", name: "新增查询", yAxisIndex: 0, symbol: "none", smooth: 0.2, showSymbol: false,
        lineStyle: { width: 2.5, color: "oklch(60% 0.21 235)", cap: "round", join: "round" },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "oklch(60% 0.21 235 / .24)" }, { offset: 1, color: "oklch(60% 0.21 235 / .03)" }]) },
        data: trend.buckets.map((bucket) => namedTimeValue(bucket.timestamp, bucket.queries)), emphasis: { disabled: true },
      },
    ],
  }), [dark, latest, maxDuration, maxQueries, reducedMotion, trend.buckets, windowSeconds]);
  return <EChartCanvas option={option} className="cursor-crosshair" lazyUpdate />;
}

function normalizeRankRows(rows: any[], total: number, danger = false): RankRow[] {
  const maxCount = Math.max(...rows.map((row) => numberValue(row.count || row.total || row.value)), 1);
  return rows.map((row) => {
    const count = numberValue(row.count || row.total || row.value);
    return {
      name: stringValue(row.name || row.key || row.value || "-"),
      value: row.display_value ? stringValue(row.display_value) : formatCount(count),
      pct: total > 0 ? Number(((count / total) * 100).toFixed(1)) : Number(((count / maxCount) * 100).toFixed(1)),
      barPct: Number(((count / maxCount) * 100).toFixed(1)),
      danger,
    };
  });
}

function slowestRows(entries: any[]): RankRow[] {
  const rows = [...entries]
    .map((entry) => ({
      name: stringValue(entry.query_name || entry.domain || entry.name || "-"),
      duration: numberValue(entry.duration_ms || entry.elapsed_ms || entry.cost_ms || entry.ms || entry.duration || entry.latency_ms),
    }))
    .filter((entry) => entry.duration > 0)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);
  const max = Math.max(...rows.map((row) => row.duration), 1);
  return rows.map((row) => ({
    name: row.name,
    value: formatMs(row.duration),
    barPct: Number(((row.duration / max) * 100).toFixed(1)),
    danger: row.duration >= 1000,
  }));
}

function rankRules(rows: any[], total: number): RuleRow[] {
  const colors = ["bg-amber-500", "bg-red-500", "bg-blue-500", "bg-red-400", "bg-green-500", "bg-slate-400", "bg-purple-500", "bg-cyan-500"];
  return rows.slice(0, 8).map((row, index) => {
    const count = numberValue(row.count || row.total);
    const name = stringValue(row.name || row.value || "未匹配规则");
    return {
      name,
      key: name,
      count: formatCount(count),
      pct: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
      color: colors[index % colors.length],
    };
  });
}

function RankList({ rows, accent, emptyLabel = "暂无数据" }: { rows: RankRow[]; accent: string; emptyLabel?: string }) {
  return (
    <SolidPlate tone="regular" className="overflow-hidden p-0">
      {rows.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
      ) : rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className="space-y-2 border-b border-border/40 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/25">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-xs font-medium text-foreground" title={r.name}>{r.name}</span>
            <span className={cn("shrink-0 text-xs font-medium tabular-nums", r.danger ? "text-red-500" : "text-muted-foreground")}>
              {r.value}
              {r.pct !== undefined && <span className="text-muted-foreground"> ({r.pct}%)</span>}
            </span>
          </div>
          <div className="ml-7 h-1 overflow-hidden rounded-full bg-muted" style={{ width: "calc(100% - 1.75rem)" }}>
            <div className={cn("h-full rounded-full", r.danger ? "bg-red-500" : accent)} style={{ width: `${Math.min(r.barPct, 100)}%` }} />
          </div>
        </div>
      ))}
    </SolidPlate>
  );
}

function RuleTable({ rows }: { rows: RuleRow[] }) {
  if (rows.length === 0) {
    return (
      <SolidPlate className="flex h-full min-h-24 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        暂无分流统计
      </SolidPlate>
    );
  }
  return (
    <SolidPlate tone="regular" className="h-full overflow-hidden p-0">
      {rows.map((row) => (
        <div key={row.key} className="space-y-2 border-b border-border/40 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/25">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">
              <span className="font-medium">{row.name}</span>{" "}
              <span className="text-xs text-muted-foreground">({row.key})</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {row.count} <span className="text-xs">({row.pct}%)</span>
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", row.color)} style={{ width: `${row.pct}%` }} />
          </div>
        </div>
      ))}
    </SolidPlate>
  );
}

const metricIcons: Record<Metric["icon"], LucideIcon> = {
  cpu: Cpu,
  memory: MemoryStick,
  activity: Activity,
  timer: Timer,
};

const cacheCfg = [
  { icon: Layers, tile: "bg-purple-500/10 text-purple-500" },
  { icon: MapPin, tile: "bg-blue-500/10 text-blue-500" },
  { icon: Globe, tile: "bg-orange-500/10 text-orange-500" },
  { icon: Server, tile: "bg-green-500/10 text-green-500" },
];

const CACHE_CARD_ORDER: Array<[key: string, title: string]> = [
  ["all", "全部缓存"],
  ["domestic", "国内缓存"],
  ["foreign", "国外缓存"],
  ["node", "节点缓存"],
];

const CACHE_CARD_ALIASES: Record<string, string[]> = {
  all: ["all", "全部缓存", "cache_all", "cache_all_noleak", "summary"],
  domestic: ["domestic", "国内缓存", "cache_cn", "cache_cnmihomo"],
  foreign: ["foreign", "国外缓存", "境外缓存", "cache_google"],
  node: ["node", "节点缓存", "cache_node", "cache_google_node"],
};

function MetricGroup({ title, metrics }: { title: string; metrics: Metric[] }) {
  return (
    <SolidPlate tone="regular" className="overflow-hidden p-0">
      <div className="border-b border-border/45 px-4 py-2.5 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="divide-y divide-border/40">
        {metrics.map((metric) => {
          const Icon = metricIcons[metric.icon];
          return (
            <div key={metric.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
              <Icon className={cn("h-4 w-4", metric.color)} />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{metric.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={metric.sub}>{metric.sub}</div>
              </div>
              <div className={cn("text-right text-base font-bold tabular-nums", metric.color)}>{metric.value}</div>
            </div>
          );
        })}
      </div>
    </SolidPlate>
  );
}

const typePill: Record<string, string> = {
  UDP: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  HTTPS: "bg-green-500/10 text-green-600 dark:text-green-400",
  TLS: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  TCP: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  AliAPI: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  mosdns: "bg-primary/10 text-primary",
};

function normalizeUpstreams(data: any): UpstreamRow[] {
  const upstreams = apiList<any>(data.upstream_summary || data.upstream_stats_summary || {}, ["upstreams"]);
  const rows = upstreams.length ? upstreams : apiList<any>(data, ["upstream_stats", "upstreams"]);
  return rows.map((row) => ({
    type: stringValue(row.protocol || row.type || "mosdns").toUpperCase(),
    name: stringValue(row.name || row.tag || "-"),
    address: stringValue(row.addr || row.address || row.url || row.name || "-"),
    avgMs: formatMs(row.avg_latency_ms || row.avg_ms || row.average_ms),
    requests: formatCount(row.query_total || row.count || row.requests),
    adoptRate: `${percentValue(row.winner_rate || row.adopt_rate).toFixed(2)}%`,
    errorRate: `${percentValue(row.error_rate).toFixed(2)}%`,
  }));
}

function cacheCard(title: string, row: any): CacheCard {
  const total = numberValue(row.query_total || row.total || row.requests);
  const hits = numberValue(row.hit_total || row.hits || row.cache_hits);
  const staleHits = numberValue(row.stale_hit_total || row.lazy_hit_total || row.stale_hits || row.lazy_hits);
  const misses = numberValue(row.miss_total || row.misses || Math.max(0, total - hits));
  return {
    title,
    total: formatCount(total),
    hits: formatCount(hits),
    staleHits: formatCount(staleHits),
    misses: formatCount(misses),
    hitRate: percentValue(row.hit_rate || (total > 0 ? hits * 100 / total : 0)),
    staleRate: percentValue(row.stale_hit_rate || (total > 0 ? staleHits * 100 / total : 0)),
    entries: formatCount(row.entries || row.size || row.entry_count || hits),
  };
}

function objectRow(value: any): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function findCacheRow(caches: any, key: string, title: string) {
  const aliases = CACHE_CARD_ALIASES[key] || [key, title];
  if (Array.isArray(caches)) {
    return caches.find((row) => {
      const rowText = [row?.key, row?.id, row?.name, row?.title, row?.tag].map(stringValue);
      const tags = Array.isArray(row?.tags) ? row.tags.map(stringValue) : [];
      return [...rowText, ...tags].some((value) => aliases.includes(value));
    });
  }
  const map = objectRow(caches);
  if (!map) return null;
  for (const alias of aliases) {
    if (objectRow(map[alias])) return map[alias];
  }
  for (const row of Object.values(map)) {
    if (!objectRow(row)) continue;
    const rowText = [row.key, row.id, row.name, row.title, row.tag].map(stringValue);
    const tags = Array.isArray(row.tags) ? row.tags.map(stringValue) : [];
    if ([...rowText, ...tags].some((value) => aliases.includes(value))) return row;
  }
  return null;
}

function normalizeCacheCards(data: any): CacheCard[] {
  const detailed = data.detailed_cache || {};
  const summary = detailed.summary || data.cache || {};
  const caches = detailed.caches || {};
  const fixedSources = CACHE_CARD_ORDER.map(([key, title]) => ({
    key,
    title,
    row: findCacheRow(caches, key, title) || (key === "all" ? summary : {}),
  }));
  const fixedRows = fixedSources.map(({ title, row }) => cacheCard(title, row));
  const hasFixedData = fixedSources.some(({ row }) =>
    numberValue(row.query_total || row.total || row.requests) > 0 ||
    numberValue(row.hit_total || row.hits || row.cache_hits) > 0 ||
    numberValue(row.entries || row.size || row.entry_count) > 0
  );
  if (hasFixedData) {
    return fixedRows;
  }
  const cards = [cacheCard("全部缓存", summary)];
  if (Array.isArray(caches)) {
    caches.slice(0, 3).forEach((row, index) => cards.push(cacheCard(stringValue(row.name || row.title || `缓存 ${index + 1}`), row)));
  } else if (caches && typeof caches === "object") {
    Object.entries(caches).slice(0, 3).forEach(([name, row]) => cards.push(cacheCard(name, row)));
  }
  CACHE_CARD_ORDER.slice(cards.length).forEach(([, title]) => cards.push(cacheCard(title, {})));
  return cards.slice(0, 4);
}

export function runtimeMetrics(data: any) {
  const stats = data.stats || {};
  const cacheQueryTotal = optionalNumber(stats.cache_query_total, data.cache?.query_total, data.cache?.total);
  const cacheHitTotal = optionalNumber(stats.cache_hit_total, data.cache?.hit_total);
  const apiCacheHitRate = optionalNumber(stats.cache_hit_rate, data.cache?.hit_rate);
  const cacheHitRate = apiCacheHitRate != null
    ? percentValue(apiCacheHitRate)
    : cacheQueryTotal != null && cacheQueryTotal > 0 && cacheHitTotal != null
      ? cacheHitTotal * 100 / cacheQueryTotal
      : null;
  const openFds = numberValue(stats.open_fds);
  const maxFds = numberValue(stats.max_fds);
  const fdPct = maxFds > 0 ? openFds * 100 / maxFds : 0;
  return {
    top: [
      { label: "CPU 使用率", value: formatPercent(stats.cpu_percent ?? data.cpu), sub: "进程 CPU 使用率", color: "text-orange-500", icon: "cpu" },
      { label: "进程内存 (RSS)", value: formatBytes(stats.process_rss_bytes), sub: "进程常驻内存大小", color: "text-blue-500", icon: "memory" },
      { label: "GOROUTINE 数量", value: formatCount(stats.go_goroutines), sub: "当前 goroutine 数量", color: "text-green-500", icon: "activity" },
      {
        label: "缓存命中率",
        value: cacheHitRate != null && cacheHitRate >= 0 && cacheHitRate <= 100 ? `${cacheHitRate.toFixed(1)}%` : "—",
        sub: cacheQueryTotal != null && cacheHitTotal != null
          ? `同口径请求 ${formatCount(cacheQueryTotal)}, 命中 ${formatCount(cacheHitTotal)}`
          : "等待同一统计周期的缓存数据",
        color: "text-cyan-500",
        icon: "activity",
      },
    ] as Metric[],
    memory: [
      { label: "堆内存使用", value: formatBytes(stats.go_heap_alloc_bytes || stats.heap_alloc_bytes), sub: "正在使用的堆内存", color: "text-purple-500", icon: "memory" },
      { label: "堆内存空闲", value: formatBytes(stats.go_heap_idle_bytes || stats.heap_idle_bytes), sub: "空闲的堆内存", color: "text-blue-500", icon: "memory" },
      { label: "堆对象数量", value: formatCount(stats.go_heap_objects || stats.heap_objects), sub: "当前堆对象数量", color: "text-green-500", icon: "activity" },
    ] as Metric[],
    system: [
      { label: "GC 次数", value: formatCount(stats.go_gc_count), sub: "垃圾回收次数", color: "text-amber-500", icon: "timer" },
      { label: "GC 耗时", value: formatMs(numberValue(stats.go_gc_duration_sec) * 1000), sub: "垃圾回收耗时", color: "text-pink-500", icon: "timer" },
      { label: "线程数", value: formatCount(stats.go_threads), sub: "运行中的线程数量", color: "text-green-500", icon: "activity" },
      { label: "文件描述符", value: `${formatCount(openFds)}/${formatCount(maxFds)} (${fdPct.toFixed(1)}%)`, sub: "已打开/最大文件描述符", color: "text-cyan-500", icon: "activity" },
    ] as Metric[],
  };
}

export default function MosdnsOverviewPage() {
  const [trendRange, setTrendRange] = useState<TimeWindowSeconds>(60);
  const [insight, setInsight] = useState<"domains" | "clients" | "slow">("domains");
  const pageVisible = usePageVisible();
  const overview = useApiPath<any>("/api/v1/mosdns/overview", [], pageVisible ? 5000 : 0);
  const queryLog = useApiPath<any>("/api/v1/mosdns/query-log?limit=250", [], pageVisible ? 1000 : 0);
  const data = apiData<any>(overview.data, {});
  const queryData = apiData<any>(queryLog.data, {});
  const entries = apiList<any>(queryData, ["logs", "items", "data"]);
  const audit = data.audit_stats || data.audit || {};
  const totalQueries = numberValue(data.query_count || audit.total_queries || entries.length);
  const avgDuration = numberValue(audit.average_duration_ms || data.stats?.average_duration_ms);
  const splitStats = useMemo(() => rankRules(apiList<any>(audit, ["top_rules"]), totalQueries), [audit, totalQueries]);
  const domainRanking = useMemo(() => normalizeRankRows(apiList<any>(audit, ["top_domains"]), totalQueries), [audit, totalQueries]);
  const clientRanking = useMemo(() => normalizeRankRows(apiList<any>(audit, ["top_clients"]), totalQueries), [audit, totalQueries]);
  const slowestQueries = useMemo(() => slowestRows(entries), [entries]);
  const upstreamStats = useMemo(() => normalizeUpstreams(data), [data]);
  const cacheCards = useMemo(() => normalizeCacheCards(data), [data]);
  const runtime = useMemo(() => runtimeMetrics(data), [data]);
  const frozenTrendRef = useRef<{ range: number; trend?: QueryTrendData }>({ range: trendRange });
  const trend = useMemo(() => {
    if (frozenTrendRef.current.range !== trendRange) frozenTrendRef.current = { range: trendRange };
    const next = freezeTrend(frozenTrendRef.current.trend, makeTrend(entries, trendRange));
    frozenTrendRef.current.trend = next;
    return next;
  }, [entries, trendRange]);
  const currentDuration = numberValue(entries[0]?.duration_ms || entries[0]?.elapsed_ms || entries[0]?.cost_ms || entries[0]?.ms || entries[0]?.duration || avgDuration);
  const running = Boolean(data.running || data.status === "running");
  const insightViews: Array<{
    key: "domains" | "clients" | "slow";
    label: string;
    icon: LucideIcon;
    rows: RankRow[];
    accent: string;
    empty: string;
  }> = [
    { key: "domains", label: "域名排行", icon: Globe, rows: domainRanking, accent: "bg-blue-500", empty: "暂无域名排行数据" },
    { key: "clients", label: "客户端排行", icon: Users, rows: clientRanking, accent: "bg-green-500", empty: "暂无客户端排行数据" },
    { key: "slow", label: "最慢查询", icon: Clock, rows: slowestQueries, accent: "bg-orange-500", empty: "暂无查询耗时数据" },
  ];
  const activeInsight = insightViews.find((view) => view.key === insight) || insightViews[0];

  return (
    <AppShell>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          icon={ChartColumn}
          title="MosDNS 概述"
          description="DNS 服务运行状态与查询统计"
          actions={(
            <div className="gary-status-pill flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", running ? "bg-green-500 animate-pulse" : "bg-gray-400")} />
            <span className="text-sm text-muted-foreground">{running ? "运行中" : "已停止"}</span>
            </div>
          )}
        />

        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
          <Card className="h-[330px] lg:col-span-2">
            <CardHeader
              icon={Activity}
              iconColor="text-primary"
              title="查询趋势"
              right={
                <div className="text-right text-xs text-muted-foreground space-y-0.5">
                  <div>当前查询数 <span className="font-semibold text-foreground">{entries.length}</span></div>
                  <div>当前耗时 <span className="font-semibold text-foreground">{formatMs(currentDuration)}</span></div>
                </div>
              }
            />
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="flex items-end gap-6 mb-3">
                <div>
                  <p className="text-2xl font-bold text-foreground leading-none">{formatCount(totalQueries)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">总查询数</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-500 leading-none">{avgDuration.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">平均耗时</p>
                </div>
              </div>
              <div className="relative min-h-[130px] flex-1 overflow-hidden px-1 py-3">
                <QueryTrendChart trend={trend} windowSeconds={trendRange} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />新增查询
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-green-500" />当前耗时
                  </span>
                </div>
                <TimeWindowSelector value={trendRange} onChange={setTrendRange} />
              </div>
            </div>
          </Card>

          <Card className={splitStats.length > 0 ? "h-[330px]" : "min-h-[160px] lg:h-[330px]"}>
            <CardHeader
              icon={Split}
              iconColor="text-primary"
              title="分流统计"
              right={
                <div className="text-right">
                  <div className="text-xl font-bold text-foreground leading-none">{formatCount(totalQueries)}</div>
                  <div className="text-xs text-muted-foreground">总计</div>
                </div>
              }
            />
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
              <RuleTable rows={splitStats} />
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex flex-col gap-3 border-b border-border/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">查询洞察</h3>
            </div>
            <div className="gary-solid-plate flex w-full gap-1 rounded-[14px] p-1 sm:w-auto" role="tablist" aria-label="查询洞察视图">
              {insightViews.map((view) => {
                const Icon = view.icon;
                const active = insight === view.key;
                return (
                  <button
                    key={view.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setInsight(view.key)}
                    className={cn(
                      "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-xs font-medium transition-[background-color,color,box-shadow] duration-200 sm:flex-none",
                      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {view.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-4" role="tabpanel">
            <RankList rows={activeInsight.rows} accent={activeInsight.accent} emptyLabel={activeInsight.empty} />
          </div>
        </Card>

        <Card>
          <CardHeader icon={Database} iconColor="text-primary" title="上游 DNS 统计" />
          <div className="m-4">
            {upstreamStats.length === 0 ? (
              <SolidPlate className="flex min-h-24 items-center justify-center p-6 text-sm text-muted-foreground">暂无上游统计</SolidPlate>
            ) : (
              <>
              <SolidPlate tone="regular" className="hidden overflow-hidden p-0 xl:block">
              <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2.5">类型</th>
                  <th className="text-left font-medium px-4 py-2.5">名称</th>
                  <th className="text-left font-medium px-4 py-2.5">地址</th>
                  <th className="text-right font-medium px-4 py-2.5">平均响应(ms)</th>
                  <th className="text-right font-medium px-4 py-2.5">请求数</th>
                  <th className="text-right font-medium px-4 py-2.5">采纳率</th>
                  <th className="text-right font-medium px-4 py-2.5">出错率</th>
                </tr>
              </thead>
              <tbody>
                {upstreamStats.map((u, i) => (
                  <tr key={`${u.name}-${i}`} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", typePill[u.type] ?? "bg-muted text-muted-foreground")}>
                        {u.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground font-medium">{u.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{u.address}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{u.avgMs}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{u.requests}</td>
                    <td className="px-4 py-2.5 text-right text-foreground">{u.adoptRate}</td>
                    <td className={cn("px-4 py-2.5 text-right", u.errorRate === "100.00%" ? "text-red-500 font-medium" : "text-muted-foreground")}>
                      {u.errorRate}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
              </SolidPlate>
              <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
                {upstreamStats.map((u, index) => (
                  <SolidPlate key={`${u.name}-compact-${index}`} tone="regular" className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", typePill[u.type] ?? "bg-muted text-muted-foreground")}>{u.type}</span>
                          <span className="truncate text-sm font-semibold text-foreground">{u.name}</span>
                        </div>
                        <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{u.address}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums">
                        <div className="font-semibold text-foreground">{u.avgMs}</div>
                        <div className="mt-1 text-muted-foreground">{u.requests} 次</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/40 pt-3 text-xs">
                      <div><span className="text-muted-foreground">采纳率</span><span className="float-right font-medium tabular-nums text-foreground">{u.adoptRate}</span></div>
                      <div><span className="text-muted-foreground">出错率</span><span className="float-right font-medium tabular-nums text-foreground">{u.errorRate}</span></div>
                    </div>
                  </SolidPlate>
                ))}
              </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Layers} iconColor="text-primary" title="缓存对比" />
          <div className="space-y-3 p-4">
            {cacheCards.map((cache, index) => {
              const cfg = cacheCfg[index % cacheCfg.length];
              const CacheIcon = cfg.icon;
              return (
                <SolidPlate key={cache.title} tone="regular" className="p-4">
                  <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_minmax(280px,0.9fr)] xl:items-center">
                    <div className="flex items-center gap-3">
                      <div className={cn("rounded-[12px] p-2", cfg.tile)}><CacheIcon className="h-4 w-4" /></div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{cache.title}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">缓存条目 {cache.entries}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                      {[
                        ["请求", cache.total],
                        ["命中", cache.hits],
                        ["过期命中", cache.staleHits],
                        ["未命中", cache.misses],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <div className="text-muted-foreground">{label}</div>
                          <div className="mt-0.5 truncate font-semibold tabular-nums text-foreground">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2.5">
                      {[
                        ["命中率", cache.hitRate, "bg-blue-500", "text-blue-600 dark:text-blue-400"],
                        ["过期命中率", cache.staleRate, "bg-amber-500", "text-amber-600 dark:text-amber-400"],
                      ].map(([label, rate, fill, textColor]) => (
                        <div key={String(label)}>
                          <div className="mb-1 flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">{String(label)}</span>
                            <span className={cn("font-semibold tabular-nums", String(textColor))}>{Number(rate).toFixed(2)}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full transition-[width] duration-300", String(fill))} style={{ width: `${Math.min(Number(rate), 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </SolidPlate>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">运行指标</h3>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              实时更新
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <MetricGroup title="核心" metrics={runtime.top} />
            <MetricGroup title="内存" metrics={runtime.memory} />
            <MetricGroup title="系统" metrics={runtime.system} />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
