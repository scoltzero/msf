import { Gauge, Loader2, Radio } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ProxyCardSize, ProxyNodeDisplay, ProxyNodeView } from "./types";

function delayTone(delay: number, alive: boolean, low: number, high: number, active: boolean) {
  if (active) return "bg-primary/12 text-primary";
  if (!alive || delay <= 0) return "bg-muted text-muted-foreground";
  if (delay < low) return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  if (delay < high) return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
  return "bg-red-500/12 text-red-700 dark:text-red-300";
}

export const ProxyNodeCard = memo(function ProxyNodeCard({
  node,
  active = false,
  testing = false,
  display = "truncate",
  cardSize = "comfortable",
  disableTextSelect = false,
  low = 400,
  high = 800,
  onSelect,
  onTest,
}: {
  node: ProxyNodeView;
  active?: boolean;
  testing?: boolean;
  display?: ProxyNodeDisplay;
  cardSize?: ProxyCardSize;
  disableTextSelect?: boolean;
  low?: number;
  high?: number;
  onSelect?: () => void;
  onTest?: () => void;
}) {
  const delay = Math.max(0, Number(node.delay) || 0);
  const alive = node.alive !== false;
  return (
    <article
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `选择 ${node.name}` : undefined}
      aria-pressed={onSelect ? active : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group/node min-w-0 border border-transparent bg-background/55 text-left transition-[background-color,border-color,transform] duration-200",
        cardSize === "compact" ? "rounded-lg px-2 py-1.5 shadow-none" : "rounded-xl px-3 py-2.5 shadow-sm",
        disableTextSelect && "select-none",
        onSelect && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
        "hover:-translate-y-0.5 hover:border-primary/25 hover:bg-background/80",
        active && "border-primary/35 bg-primary/8 text-primary",
        !alive && "opacity-70"
      )}
    >
      <div className={cn("flex min-w-0 items-start", cardSize === "compact" ? "gap-1.5" : "gap-2")}>
        {node.icon ? <img src={node.icon} alt="" className={cn("mt-0.5 shrink-0 rounded object-contain", cardSize === "compact" ? "h-3.5 w-3.5" : "h-4 w-4")} referrerPolicy="no-referrer" /> : <Radio className={cn("mt-0.5 shrink-0 text-muted-foreground", cardSize === "compact" ? "h-3.5 w-3.5" : "h-4 w-4")} />}
        <span className={cn("min-w-0 flex-1 text-xs font-medium", display === "wrap" ? "break-words" : "truncate")} title={node.name}>{node.name}</span>
        {active ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="当前节点" /> : null}
      </div>
      <div className={cn("flex items-center justify-between", cardSize === "compact" ? "mt-0.5 gap-1" : "mt-2 gap-2")}>
        <span className={cn("min-w-0 text-muted-foreground", cardSize === "compact" ? "text-[10px] leading-4" : "text-[11px]", display === "wrap" ? "break-words" : "truncate")} title={node.type || undefined}>{node.type || node.providerName || "节点"}</span>
        {onTest ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); onTest(); }} disabled={testing} className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45", cardSize === "compact" ? "h-5 min-w-8 px-1" : "h-6 min-w-9 px-1.5", delayTone(delay, alive, low, high, active))} title={`测试 ${node.name} 延迟`} aria-label={`测试 ${node.name} 延迟`}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : delay > 0 ? `${delay}` : <Gauge className="h-3 w-3" />}
          </button>
        ) : <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums", cardSize === "compact" ? "h-5 min-w-8 px-1" : "h-6 min-w-9 px-1.5", delayTone(delay, alive, low, high, active))}>{delay > 0 ? delay : <Gauge className="h-3 w-3" />}</span>}
      </div>
    </article>
  );
});
