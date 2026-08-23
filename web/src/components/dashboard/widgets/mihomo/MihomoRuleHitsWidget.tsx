"use client";

import { useMihomoDashboardData } from "../../data";
import type { MihomoWidgetSize } from "./MihomoTrafficWidget";

export function ruleHitDisplayLimit(size: MihomoWidgetSize) { return size === "s" ? 10 : size === "l" ? 24 : 16; }
export type MihomoRuleHitsWidgetProps = { size?: MihomoWidgetSize };
export function MihomoRuleHitsWidget({ size = "m" }: MihomoRuleHitsWidgetProps) {
  const { ruleHits } = useMihomoDashboardData();
  if (!ruleHits.length) return <div className="flex h-full min-h-28 items-center justify-center rounded-xl border border-dashed border-border/55 px-4 text-center text-xs text-muted-foreground">当前 Mihomo 未提供规则 extra.hitCount，未生成估算数据</div>;
  const rows = ruleHits.slice(0, ruleHitDisplayLimit(size));
  const maximum = Math.max(1, ...rows.map((row) => row.hits));
  return <div className="grid h-full items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>{rows.map((rule) => <div key={rule.name} className="flex h-full min-w-0 flex-col justify-end" title={`${rule.name}${rule.lastHit ? `\n最近命中：${rule.lastHit}` : ""}`}><div className="mb-1 text-center text-[9px] tabular-nums">{rule.hits}</div><div className="mx-auto w-[72%] min-w-1.5 rounded-t bg-violet-500/55" style={{ height: `${Math.max(2, rule.hits / maximum * 82)}%` }} /><div className="mt-2 h-8 overflow-hidden text-center text-[8px] leading-3 text-muted-foreground">{rule.name.replace(" · ", "\n")}</div></div>)}</div>;
}
