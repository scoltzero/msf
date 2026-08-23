"use client";

import { formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { useMihomoDashboardData, type MihomoProviderTraffic } from "../../data";
import type { MihomoWidgetSize } from "./MihomoTrafficWidget";

export function providerUsage(provider: Pick<MihomoProviderTraffic, "used" | "total">) {
  const percent = provider.total > 0 ? Math.min(100, Math.max(0, provider.used / provider.total * 100)) : 0;
  return { percent, remaining: Math.max(0, provider.total - provider.used), tone: percent >= 90 ? "danger" : percent >= 70 ? "warning" : "normal" } as const;
}

export type MihomoProviderTrafficWidgetProps = { size?: MihomoWidgetSize };
export function MihomoProviderTrafficWidget({ size = "m" }: MihomoProviderTrafficWidgetProps) {
  const { providers } = useMihomoDashboardData();
  if (!providers.length) return <div className="flex h-full min-h-28 items-center justify-center rounded-xl border border-dashed border-border/55 px-4 text-center text-xs text-muted-foreground">当前 Provider 没有可用的订阅配额信息</div>;
  const totals = providers.reduce((sum, row) => ({ used: sum.used + row.used, total: sum.total + row.total }), { used: 0, total: 0 });
  const rows: MihomoProviderTraffic[] = providers.length > 1 ? [{ name: "全部订阅", ...totals, upload: 0, download: 0, expire: "" }, ...providers] : providers;
  return <div className="@container h-full min-h-0"><div className={cn("grid max-h-full gap-2 overflow-y-auto pr-1", size === "s" ? "grid-cols-1" : "grid-cols-1 @min-[620px]:grid-cols-2 @min-[980px]:grid-cols-3")}>
    {rows.map((provider) => { const usage = providerUsage(provider); return <SolidPlate tone="regular" key={provider.name} className="p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{provider.name}</span><span className="text-[10px] tabular-nums text-muted-foreground">{usage.percent.toFixed(1)}%</span></div><div className="mt-2 text-lg font-light tabular-nums">{formatBytes(provider.used)} <span className="text-xs text-muted-foreground">/ {formatBytes(provider.total)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", usage.tone === "danger" ? "bg-rose-500" : usage.tone === "warning" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${usage.percent}%` }} /></div><div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground"><span>剩余 {formatBytes(usage.remaining)}</span>{provider.expire ? <span className="truncate pl-2">到期 {provider.expire}</span> : null}</div></SolidPlate>; })}
  </div></div>;
}
