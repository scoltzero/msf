import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, CircleSlash2, Route } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { highlightText, type RuleSearchMatcher } from "@/features/mihomo-rules/search";
import type { RuleTargetState, RuntimeRule } from "@/features/mihomo-rules/types";
import { RuntimeRuleDetails } from "./RuntimeRuleDetails";
import { RuleHitStatsPopover } from "./RuleHitStatsPopover";

const typeTone: Record<string, string> = {
  "dst-port": "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "domain-suffix": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "domain-keyword": "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  domain: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "ip-cidr": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ruleset: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "rule-set": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  geoip: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  match: "bg-muted text-muted-foreground",
};

function Highlight({ value, matcher }: { value: string; matcher: RuleSearchMatcher }) {
  return <>{highlightText(value, matcher).map((segment, index) => segment.matched ? <mark key={`${index}-${segment.text}`} className="rounded bg-primary/20 px-0.5 text-inherit">{segment.text}</mark> : <span key={`${index}-${segment.text}`}>{segment.text}</span>)}</>;
}

function delayTone(delay?: number): string {
  if (!delay) return "text-muted-foreground";
  if (delay < 200) return "text-emerald-700 dark:text-emerald-300";
  if (delay < 800) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

export function RuntimeRuleRow({
  rule,
  target,
  matcher,
  expanded,
  ruleToggle,
  disconnectMatched,
  onExpand,
  onToggle,
  onResize,
  selectingTarget,
  onSelectTarget,
}: {
  rule: RuntimeRule;
  target?: RuleTargetState;
  matcher: RuleSearchMatcher;
  expanded: boolean;
  ruleToggle: boolean;
  disconnectMatched: boolean;
  onExpand: () => void;
  onToggle: (disabled: boolean) => void;
  onResize?: (height: number) => void;
  selectingTarget: boolean;
  onSelectTarget?: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !onResize) return undefined;
    const measure = () => onResize(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onResize]);
  const tone = typeTone[rule.normalizedType] ?? "bg-muted text-muted-foreground";
  const chainLabel = target?.finalNode ?? target?.selectedName ?? rule.target;
  const canSelectTarget = Boolean(target?.members?.length && onSelectTarget);
  return (
    <div ref={ref} className="py-0.5">
      <SolidPlate tone="regular" className={rule.disabled ? "opacity-60" : ""}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 p-2.5 sm:items-center">
          <div className="flex items-center gap-1">
            <button type="button" onClick={onExpand} aria-expanded={expanded} aria-label={expanded ? "收起规则详情" : "展开规则详情"} className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
              <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">#{rule.index}</span>
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`} title={rule.type}>{rule.disabled ? <CircleSlash2 className="h-3 w-3" aria-hidden="true" /> : null}{rule.type}</span>
              <span className="min-w-0 truncate font-mono text-sm text-foreground" title={rule.payload || "（空 payload）"}>{rule.payload ? <Highlight value={rule.payload} matcher={matcher} /> : <span className="italic text-muted-foreground">（空 payload）</span>}</span>
              {rule.size !== undefined && rule.size > 0 ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">({rule.size})</span> : null}
            </div>
            <button type="button" onClick={canSelectTarget && !expanded ? onExpand : undefined} disabled={!canSelectTarget} className="flex max-w-full items-center gap-1.5 rounded-lg bg-muted/65 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:hover:bg-muted/65 disabled:hover:text-muted-foreground" title={canSelectTarget ? `${expanded ? "下方可选择" : "展开并选择"} ${rule.target} 的节点` : rule.target}>
              <Route className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[8rem] truncate">{rule.target || "未指定策略"}</span>
              {chainLabel && chainLabel !== rule.target ? <><ChevronRight className="h-3 w-3 shrink-0 opacity-55" aria-hidden="true" /><span className="min-w-0 truncate text-foreground">{chainLabel}</span></> : null}
              {target?.delay ? <span className={`ml-auto shrink-0 font-mono tabular-nums ${delayTone(target.delay)}`}>{target.delay} ms</span> : null}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <RuleHitStatsPopover rule={rule} />
            <button
              type="button"
              role="switch"
              aria-checked={!rule.disabled}
              disabled={!ruleToggle}
              onClick={() => onToggle(!rule.disabled)}
              title={ruleToggle ? `仅本次运行，重启后按配置恢复${disconnectMatched ? "；禁用时断开精确匹配连接" : ""}` : "不受当前内核支持"}
              aria-label={ruleToggle ? (rule.disabled ? "启用规则" : "禁用规则") : "当前内核不支持规则启用禁用"}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border px-0.5 transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${ruleToggle ? (!rule.disabled ? "border-primary/35 bg-primary/25" : "border-border bg-muted") : "cursor-not-allowed border-border/60 bg-muted/50 opacity-60"}`}
            >
              <span className={`h-4.5 w-4.5 rounded-full bg-foreground shadow-sm transition-transform duration-150 ${!rule.disabled ? "translate-x-4" : "translate-x-0"}`} aria-hidden="true" />
            </button>
          </div>
        </div>
        {expanded ? <RuntimeRuleDetails rule={rule} target={target} selecting={selectingTarget} onSelectTarget={onSelectTarget} /> : null}
      </SolidPlate>
    </div>
  );
}
