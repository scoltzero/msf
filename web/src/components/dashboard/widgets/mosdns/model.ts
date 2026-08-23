import { apiList, formatBytes, formatPercent } from "@/lib/api";
import { timestampMs } from "@/components/charts/timeSeries";

export type MosdnsWidgetSize = "xs" | "s" | "m" | "l";
export type MosdnsInfoPage = "split" | "domains" | "slowest" | "clients";
export type MosdnsCachePage = "all" | "domestic" | "foreign" | "node";
export type MosdnsRuntimePage = "overview" | "memory" | "system";
export type MosdnsCacheSystemPage = "stats" | "strategy" | "task" | "operations";

export function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function safePercent(value: unknown, numerator = 0, denominator = 0) {
  const explicit = finiteNumber(value);
  if (explicit) return Math.max(0, Math.min(100, explicit > 0 && explicit <= 1 ? explicit * 100 : explicit));
  return denominator > 0 ? Math.max(0, Math.min(100, numerator * 100 / denominator)) : 0;
}

export interface MosdnsTrendBucket { timestamp: number; queries: number; durationMs: number }
export function freezeMosdnsTrend(previous: MosdnsTrendBucket[] | undefined, incoming: MosdnsTrendBucket[]) {
  if (!previous?.length || !incoming.length) return incoming;
  const first = incoming[0].timestamp;
  const last = incoming[incoming.length - 1].timestamp;
  const buckets = new Map(incoming.map((bucket) => [bucket.timestamp, bucket]));
  previous.forEach((bucket) => { if (bucket.timestamp >= first && bucket.timestamp <= last) buckets.set(bucket.timestamp, bucket); });
  return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
}
export function buildMosdnsTrend(entries: any[], windowSeconds: number, now = Date.now()): MosdnsTrendBucket[] {
  const end = Math.floor(now / 1000) * 1000;
  const count = Math.max(10, Math.round(windowSeconds));
  const start = end - count * 1000;
  const buckets = Array.from({ length: count }, (_, index) => ({ timestamp: start + (index + 1) * 1000, queries: 0, totalDuration: 0, durations: 0 }));
  entries.forEach((entry, index) => {
    const parsed = timestampMs(entry.query_time ?? entry.time ?? entry.timestamp ?? entry.created_at);
    const time = parsed > 0 ? parsed : end - Math.max(1, entries.length - index) * 1000;
    const bucket = Math.floor((time - start) / 1000);
    if (bucket < 0 || bucket >= buckets.length) return;
    buckets[bucket].queries += 1;
    const duration = finiteNumber(entry.duration_ms ?? entry.elapsed_ms ?? entry.cost_ms ?? entry.ms ?? entry.duration ?? entry.latency_ms);
    buckets[bucket].totalDuration += duration;
    if (duration > 0) buckets[bucket].durations += 1;
  });
  return buckets.map((bucket) => ({ timestamp: bucket.timestamp, queries: bucket.queries, durationMs: bucket.durations ? bucket.totalDuration / bucket.durations : 0 }));
}

export function normalizeMosdnsInfo(overview: Record<string, any>, entries: any[]) {
  const audit = overview.audit_stats || overview.audit || {};
  const total = finiteNumber(overview.query_count ?? audit.total_queries ?? entries.length);
  const rank = (rows: any[]) => {
    const max = Math.max(...rows.map((row) => finiteNumber(row.count ?? row.total ?? row.value)), 1);
    return rows.slice(0, 24).map((row) => { const count = finiteNumber(row.count ?? row.total ?? row.value); return { name: String(row.name ?? row.key ?? row.value ?? "-"), value: Math.round(count).toLocaleString(), percent: safePercent(undefined, count, total || max) }; });
  };
  const slowest = [...entries].map((row) => ({ name: String(row.query_name ?? row.domain ?? row.name ?? "-"), duration: finiteNumber(row.duration_ms ?? row.elapsed_ms ?? row.cost_ms ?? row.ms ?? row.duration) })).filter((row) => row.duration > 0).sort((a, b) => b.duration - a.duration).slice(0, 24);
  const slowMax = Math.max(...slowest.map((row) => row.duration), 1);
  return {
    total,
    split: rank(apiList(audit, ["top_rules"])),
    domains: rank(apiList(audit, ["top_domains"])),
    clients: rank(apiList(audit, ["top_clients"])),
    slowest: slowest.map((row) => ({ name: row.name, value: `${row.duration.toFixed(2)} ms`, percent: safePercent(undefined, row.duration, slowMax), danger: row.duration >= 1000 })),
  };
}

const CACHE_KEYS: Array<[MosdnsCachePage, string, string[]]> = [
  ["all", "全部", ["all", "summary", "cache_all", "全部缓存"]],
  ["domestic", "国内", ["domestic", "cache_cn", "cache_cnmihomo", "国内缓存"]],
  ["foreign", "国外", ["foreign", "cache_google", "国外缓存", "境外缓存"]],
  ["node", "节点", ["node", "cache_node", "cache_google_node", "节点缓存"]],
];

function cacheSource(overview: Record<string, any>, aliases: string[], all: boolean) {
  const detailed = overview.detailed_cache || {};
  const caches = detailed.caches || {};
  if (Array.isArray(caches)) return caches.find((row) => aliases.includes(String(row.key ?? row.id ?? row.name ?? row.title ?? row.tag))) || (all ? detailed.summary || overview.cache || {} : {});
  for (const alias of aliases) if (caches?.[alias] && typeof caches[alias] === "object") return caches[alias];
  return all ? detailed.summary || overview.cache || {} : {};
}

export function normalizeMosdnsCaches(overview: Record<string, any>) {
  return Object.fromEntries(CACHE_KEYS.map(([key, label, aliases]) => {
    const row = cacheSource(overview, aliases, key === "all");
    const total = finiteNumber(row.query_total ?? row.total ?? row.requests);
    const hits = finiteNumber(row.hit_total ?? row.hits ?? row.cache_hits);
    const staleHits = finiteNumber(row.stale_hit_total ?? row.lazy_hit_total ?? row.stale_hits ?? row.lazy_hits);
    return [key, { key, label, total, hits, staleHits, misses: finiteNumber(row.miss_total ?? row.misses ?? Math.max(0, total - hits)), hitRate: safePercent(row.hit_rate, hits, total), staleRate: safePercent(row.stale_hit_rate, staleHits, total), entries: finiteNumber(row.entries ?? row.size ?? row.entry_count ?? hits) }];
  })) as Record<MosdnsCachePage, { key: MosdnsCachePage; label: string; total: number; hits: number; staleHits: number; misses: number; hitRate: number; staleRate: number; entries: number }>;
}

export function normalizeMosdnsRuntime(overview: Record<string, any>) {
  const stats = overview.stats || {};
  const queryTotal = finiteNumber(stats.cache_query_total ?? overview.query_count);
  const hitTotal = finiteNumber(stats.cache_hit_total ?? overview.cache?.hit_total);
  const open = finiteNumber(stats.open_fds), max = finiteNumber(stats.max_fds);
  return {
    overview: [
      { label: "CPU 使用率", value: formatPercent(stats.cpu_percent ?? overview.cpu), sub: "进程 CPU" },
      { label: "进程内存", value: formatBytes(stats.process_rss_bytes), sub: "RSS" },
      { label: "Goroutine", value: finiteNumber(stats.go_goroutines).toLocaleString(), sub: "当前数量" },
      { label: "缓存命中率", value: `${safePercent(overview.cache?.hit_rate, hitTotal, queryTotal).toFixed(1)}%`, sub: `${hitTotal.toLocaleString()} / ${queryTotal.toLocaleString()}` },
    ],
    memory: [
      { label: "堆内存使用", value: formatBytes(stats.go_heap_alloc_bytes ?? stats.heap_alloc_bytes), sub: "Heap alloc" },
      { label: "堆内存空闲", value: formatBytes(stats.go_heap_idle_bytes ?? stats.heap_idle_bytes), sub: "Heap idle" },
      { label: "堆对象数量", value: finiteNumber(stats.go_heap_objects ?? stats.heap_objects).toLocaleString(), sub: "Heap objects" },
    ],
    system: [
      { label: "GC 次数", value: finiteNumber(stats.go_gc_count).toLocaleString(), sub: "垃圾回收" },
      { label: "GC 耗时", value: `${(finiteNumber(stats.go_gc_duration_sec) * 1000).toFixed(2)} ms`, sub: "累计耗时" },
      { label: "线程数", value: finiteNumber(stats.go_threads).toLocaleString(), sub: "运行线程" },
      { label: "文件描述符", value: `${open}/${max} (${safePercent(undefined, open, max).toFixed(1)}%)`, sub: "已打开 / 上限" },
    ],
  };
}
