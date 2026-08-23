"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Search, Pause, Play, ChevronDown, ChevronUp, ListFilter, Sparkles, Check, Copy, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { cn } from "@/lib/utils";
import { ToastStack, type ToastItem } from "@/components/rules/RuleDialogs";
import { api, apiData, apiList } from "@/lib/api";

interface QueryRow {
  id: string;
  seq: number;
  time: string;
  domain: string;
  client: string;
  type: string;
  rule: string;
  status: string;
  answer?: string;
  ms: string;
}

type ColKey = "domain" | "client" | "type" | "rule" | "status";

const columns: { label: string; key?: ColKey; sort?: boolean; align?: string }[] = [
  { label: "时间", sort: true },
  { label: "域名", key: "domain" },
  { label: "查询结果" },
  { label: "客户端", key: "client" },
  { label: "类型", key: "type" },
  { label: "分流规则", key: "rule" },
  { label: "响应状态", key: "status" },
  { label: "耗时 (ms)", align: "right" },
];

const ruleColor: Record<string, string> = {
  unmatched_rule: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  my_nov6rule: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  cuscn: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  BANHTTPS: "bg-red-500/10 text-red-600 dark:text-red-400",
  my_fakeiprule: "bg-cyan-600/10 text-cyan-700 dark:text-cyan-500",
};

function textValue(item: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return fallback;
}

function formatTime(value: string) {
  if (!value) return "-";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function formatMs(value: unknown) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "-";
  return ms.toFixed(2);
}

function formatAnswerItem(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    return value
      .replace(/^\s*(?:A|AAAA|CNAME|HTTPS|SVCB|TXT|MX|NS|PTR|SOA)\s*:\s*/i, "")
      .replace(/\s*\(TTL\s*:?\s*\d+(?:\.\d+)?s?\)\s*$/i, "")
      .trim();
  }
  if (typeof value !== "object") return String(value);
  const answer = value as Record<string, unknown>;
  const data = textValue(answer, ["data", "value", "answer", "ip", "target"]);
  return data ? formatAnswerItem(data) : "";
}

function formatAnswer(value: unknown) {
  if (Array.isArray(value)) {
    const answers = value.map(formatAnswerItem).filter(Boolean);
    return answers.length ? answers.join(" · ") : undefined;
  }
  const answer = formatAnswerItem(value);
  return answer || undefined;
}

function emptyAnswerLabel(status: string) {
  const normalized = status.toUpperCase();
  if (["NXDOMAIN", "SERVFAIL", "REFUSED", "FORMERR", "NOTIMP"].includes(normalized)) return "无结果";
  return "未记录应答";
}

function normalizeQueryRow(item: unknown, index: number): QueryRow {
  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const rawTime = textValue(row, ["query_time", "time", "timestamp", "created_at"]);
  const parsed = Date.parse(rawTime);
  return {
    id: textValue(row, ["trace_id", "id"], `query-${index}`),
    seq: Number.isFinite(parsed) ? parsed : Date.now() - index,
    time: formatTime(rawTime),
    domain: textValue(row, ["query_name", "domain", "host"], "-"),
    client: textValue(row, ["client_ip", "client", "src"], "-"),
    type: textValue(row, ["query_type", "type", "qtype"], "-"),
    rule: textValue(row, ["domain_set", "rule", "matched_rule"], "-"),
    status: textValue(row, ["response_code", "response", "status"], "-"),
    answer: formatAnswer(row.answers ?? row.answer),
    ms: formatMs(row.duration_ms ?? row.elapsed_ms ?? row.cost_ms ?? row.duration ?? row.elapsed ?? row.cost),
  };
}

export default function QueryLogPage() {
  const [allRows, setAllRows] = useState<QueryRow[]>([]);
  const [query, setQuery] = useState("");
  const [exact, setExact] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openFilter, setOpenFilter] = useState<ColKey | null>(null);
  const [filters, setFilters] = useState<Record<ColKey, Set<string>>>({
    domain: new Set(),
    client: new Set(),
    type: new Set(),
    rule: new Set(),
    status: new Set(),
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [horizontalOverflow, setHorizontalOverflow] = useState({ exists: false, left: false, right: false });

  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2000);
  }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api("/api/v1/mosdns/query-log?limit=500");
      const data = apiData<any>(payload, payload);
      const rows = apiList<any>(data, ["logs", "items", "data"]).map(normalizeQueryRow);
      setAllRows(rows);
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "查询日志加载失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load, paused]);

  const distinct = (key: ColKey) => [...new Set(allRows.map((r) => r[key]).filter(Boolean))];
  const toggleFilterValue = (key: ColKey, val: string) =>
    setFilters((f) => {
      const next = new Set(f[key]);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return { ...f, [key]: next };
    });

  const copy = (val: string) => {
    navigator.clipboard?.writeText(val);
    showToast("已复制");
  };

  const visible = useMemo(() => {
    let out = allRows.filter((r) => {
      if (query) {
        const match = exact
          ? r.domain === query || r.client === query || r.answer === query
          : `${r.domain}${r.client}${r.answer || ""}`.toLowerCase().includes(query.toLowerCase());
        if (!match) return false;
      }
      for (const key of ["domain", "client", "type", "rule", "status"] as ColKey[]) {
        if (filters[key].size && !filters[key].has(r[key])) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => (sortDesc ? b.seq - a.seq : a.seq - b.seq));
    return out;
  }, [allRows, query, exact, filters, sortDesc]);

  const updateHorizontalOverflow = useCallback(() => {
    const container = tableScrollRef.current;
    if (!container) return;
    const exists = container.scrollWidth > container.clientWidth + 1;
    const left = exists && container.scrollLeft > 2;
    const right = exists && container.scrollLeft + container.clientWidth < container.scrollWidth - 2;
    setHorizontalOverflow((current) =>
      current.exists === exists && current.left === left && current.right === right
        ? current
        : { exists, left, right },
    );
  }, []);

  useEffect(() => {
    const container = tableScrollRef.current;
    if (!container) return;
    updateHorizontalOverflow();
    const observer = new ResizeObserver(updateHorizontalOverflow);
    observer.observe(container);
    if (container.firstElementChild instanceof HTMLElement) observer.observe(container.firstElementChild);
    return () => observer.disconnect();
  }, [updateHorizontalOverflow, visible.length]);

  return (
    <AppShell>
      <div className="space-y-4 animate-fade-in" onClick={() => setOpenFilter(null)}>
        <WorkbenchHeader
          icon={Search}
          title="DNS 日志"
          description="查询和分析 DNS 请求记录"
          actions={(
            <>
            <button
              onClick={() => setPaused((v) => !v)}
              className={cn(
                "w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors flex-shrink-0",
                paused
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                  : "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/20"
              )}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? "开始刷新" : "暂停刷新"}
            </button>
            <button
              onClick={() => void load()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
            <button
              onClick={() => setExact((v) => !v)}
              className={cn(
                "w-full sm:w-auto flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-all flex-shrink-0 text-sm font-medium",
                exact ? "bg-primary/10 border-primary text-primary hover:bg-primary/20" : "bg-background border-border text-foreground hover:bg-accent"
              )}
            >
              <Sparkles className="h-4 w-4" />
              {exact ? "精准匹配" : "模糊搜索"}
            </button>
            </>
          )}
          summary={(
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="全局搜索..."
                className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          )}
        />

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {horizontalOverflow.exists && (
          <div className="flex items-center justify-end gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
            <span className="h-px w-5 bg-border" />
            左右滑动查看更多列
          </div>
        )}

        <div className="relative overflow-hidden rounded-lg border border-border bg-background">
          <div
            ref={tableScrollRef}
            onScroll={updateHorizontalOverflow}
            className="scrollbar-thin max-h-[calc(100vh-220px)] overflow-x-auto overflow-y-auto overscroll-contain scroll-pb-[var(--gary-mobile-nav-clearance)] md:scroll-pb-0"
            tabIndex={0}
            aria-label="查询日志表格，可横向滚动查看更多列"
          >
            <table className="w-full min-w-[1120px] table-fixed text-sm">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-muted/30 backdrop-blur">
                  {columns.map((c) => {
                    const active = c.key ? filters[c.key].size > 0 : false;
                    return (
                      <th
                        key={c.label}
                        className={cn(
                          "relative whitespace-nowrap bg-muted/30 px-3 py-2 text-left font-medium text-muted-foreground",
                          c.align === "right" && "text-right",
                          c.key === "domain" && "sticky left-0 z-20 bg-background/95 shadow-[1px_0_0_var(--border)] backdrop-blur-sm",
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {c.label}
                          {c.sort && (
                            <button onClick={(e) => { e.stopPropagation(); setSortDesc((v) => !v); }} className="hover:text-foreground transition-colors">
                              {sortDesc ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {c.key && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === c.key ? null : c.key!); }}
                              className={cn("transition-colors", active ? "text-primary" : "text-muted-foreground/60 hover:text-foreground")}
                            >
                              <ListFilter className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                        {c.key && openFilter === c.key && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute left-0 top-full mt-1 z-20 w-52 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg p-1.5 font-normal"
                          >
                            {distinct(c.key).map((v) => {
                              const sel = filters[c.key!].has(v);
                              return (
                                <button
                                  key={v}
                                  onClick={() => toggleFilterValue(c.key!, v)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-foreground hover:bg-accent text-left"
                                >
                                  <span className={cn("flex h-4 w-4 items-center justify-center rounded border", sel ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                                    {sel && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="truncate">{v}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      {loading ? "正在加载查询日志..." : "暂无查询日志"}
                    </td>
                  </tr>
                )}
                {visible.map((r) => (
                  <tr key={r.id} className="group border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">{r.time}</td>
                    <td className="sticky left-0 z-[5] bg-background px-3 py-2 shadow-[1px_0_0_var(--border)] transition-colors group-hover:bg-muted">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate" title={r.domain}>{r.domain}</span>
                        <button onClick={() => copy(r.domain)} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 overflow-hidden">
                      {r.answer ? (
                        <div className="font-mono text-xs truncate" title={r.answer}>{r.answer}</div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{emptyAnswerLabel(r.status)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.client}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.type}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn("px-2 py-1 rounded-md text-xs font-medium", ruleColor[r.rule] || "bg-muted text-muted-foreground")}>{r.rule}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-xs">{r.ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {horizontalOverflow.left && <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-5 bg-gradient-to-r from-background/80 to-transparent" />}
          {horizontalOverflow.right && <div className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 bg-gradient-to-l from-background/90 to-transparent" />}
        </div>
      </div>
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
