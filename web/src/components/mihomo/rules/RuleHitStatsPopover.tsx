import { useState } from "react";
import { Activity } from "lucide-react";
import type { RuntimeRule } from "@/features/mihomo-rules/types";

function timeLabel(value?: string): string {
  if (!value) return "暂无记录";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : value;
}

export function RuleHitStatsPopover({ rule }: { rule: RuntimeRule }) {
  const [open, setOpen] = useState(false);
  const observed = rule.hitCount !== undefined || rule.missCount !== undefined;
  return (
    <span className="group/stats relative shrink-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-muted/75 px-2 text-[11px] tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label={`查看规则 #${rule.index} 命中记录`}
        aria-describedby={`rule-stats-${rule.index}`}
        aria-expanded={open}
      >
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{observed ? `命中 ${rule.hitCount ?? 0}` : "暂无统计"}</span>
      </button>
      <span
        id={`rule-stats-${rule.index}`}
        role="tooltip"
        className={`pointer-events-none absolute right-0 top-[calc(100%+0.4rem)] z-30 w-56 rounded-xl border border-border/70 bg-popover px-3 py-2 text-left text-xs leading-5 text-popover-foreground shadow-xl transition-[opacity,transform] duration-150 group-hover/stats:visible group-hover/stats:translate-y-0 group-hover/stats:opacity-100 group-focus-within/stats:visible group-focus-within/stats:translate-y-0 group-focus-within/stats:opacity-100 ${open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"}`}
      >
        <span className="flex items-center justify-between gap-3"><span className="text-muted-foreground">命中次数</span><strong className="tabular-nums">{rule.hitCount ?? "—"}</strong></span>
        <span className="flex items-center justify-between gap-3"><span className="text-muted-foreground">未命中次数</span><strong className="tabular-nums">{rule.missCount ?? "—"}</strong></span>
        <span className="mt-1 block border-t border-border/60 pt-1 text-muted-foreground">最后命中：{timeLabel(rule.lastHitAt)}</span>
        <span className="block text-muted-foreground">最后未命中：{timeLabel(rule.lastMissAt)}</span>
      </span>
    </span>
  );
}
