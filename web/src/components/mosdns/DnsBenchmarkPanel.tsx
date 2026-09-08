"use client";

import { useCallback, useState } from "react";
import { Gauge, Loader2, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";

export type DnsBenchmarkCandidate = {
  name: string;
  vendor: string;
  protocol: string;
  addr: string;
};

type DnsBenchmarkItem = DnsBenchmarkCandidate & {
  ok: boolean;
  successes: number;
  rounds: number;
  avg_ms: number;
  error?: string;
};

type DnsBenchmarkPayload = {
  results?: DnsBenchmarkItem[];
  recommended?: DnsBenchmarkItem[];
  took_ms?: number;
  note?: string;
};

function protocolBadge(item: DnsBenchmarkItem) {
  const label = item.protocol === "doh" ? "DoH" : item.protocol === "gateway" ? "网关" : "UDP";
  return label;
}

export function DnsBenchmarkPanel({
  onApply,
  applyLabel = "应用推荐配置",
  description = "对主流公共 DNS 与本网络网关实测 3 轮（含不存在域），自动剔除不可达者并推荐跨供应商 Top3。",
}: {
  onApply?: (recommended: DnsBenchmarkCandidate[]) => void;
  applyLabel?: string;
  description?: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<DnsBenchmarkPayload | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const data = await api<DnsBenchmarkPayload>("/api/v1/system/dns-benchmark", {
        method: "POST",
        timeoutMs: 60000,
      });
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  const recommended = payload?.recommended ?? [];
  const results = payload?.results ?? [];
  const usable = results.filter((item) => item.ok);
  const dead = results.filter((item) => !item.ok);
  const applied = onApply && recommended.length > 0;

  return (
    <SolidPlate tone="subtle" className="rounded-2xl px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Gauge className="h-4 w-4 text-primary" />
            DNS 上游测速
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <GlassButton
          variant={payload ? "secondary" : "primary"}
          type="button"
          onClick={running ? undefined : run}
          aria-disabled={running}
          className="h-9 px-4 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          {running ? "测速中…" : payload ? "重新测速" : "开始测速"}
        </GlassButton>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {payload && (
        <div className="mt-4 space-y-4">
          {recommended.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                推荐组合（跨供应商，{payload.took_ms ? `总耗时 ${(payload.took_ms / 1000).toFixed(1)}s` : ""}）
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {recommended.map((item, index) => (
                  <div
                    key={item.addr}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        #{index + 1}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-mono">{protocolBadge(item)}</span>
                      <span className="font-medium text-foreground/80">{item.avg_ms.toFixed(0)}ms</span>
                    </div>
                  </div>
                ))}
              </div>
              {applied && (
                <div className="mt-3">
                  <GlassButton
                    variant="primary"
                    type="button"
                    onClick={() => onApply(recommended)}
                    className="h-9 px-5 text-sm"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {applyLabel}
                  </GlassButton>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              {payload.note || "没有测得可用上游。"}
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              全部结果（可用 {usable.length} · 不可达 {dead.length}）
            </summary>
            <div className="mt-2 overflow-hidden rounded-xl border border-border/30">
              <div className="grid grid-cols-[minmax(96px,1fr)_54px_minmax(0,1fr)_72px] items-center bg-foreground/[0.03] px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                <span>名称</span>
                <span className="text-center">协议</span>
                <span className="font-mono">地址</span>
                <span className="text-right">平均延迟</span>
              </div>
              {results
                .slice()
                .sort((a, b) => Number(b.ok) - Number(a.ok) || a.avg_ms - b.avg_ms)
                .map((item) => (
                  <div
                    key={`${item.protocol}-${item.addr}`}
                    className="grid grid-cols-[minmax(96px,1fr)_54px_minmax(0,1fr)_72px] items-center border-t border-border/20 px-3 py-1.5 text-xs"
                  >
                    <span className={cn("truncate font-medium", item.ok ? "text-foreground" : "text-muted-foreground line-through")}>
                      {item.name}
                    </span>
                    <span className="text-center text-[11px] text-muted-foreground">{protocolBadge(item)}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{item.addr}</span>
                    <span className={cn("text-right font-medium", item.ok ? "text-foreground" : "text-muted-foreground")}>
                      {item.ok ? `${item.avg_ms.toFixed(0)}ms` : "超时"}
                    </span>
                  </div>
                ))}
            </div>
          </details>
        </div>
      )}
    </SolidPlate>
  );
}
