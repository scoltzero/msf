import { AlertTriangle, Loader2 } from "lucide-react";
import { ProxyNodeGrid } from "@/components/mihomo/proxies/ProxyNodeGrid";
import type { ProxyNodeView } from "@/components/mihomo/proxies/types";
import type { RuleTargetState, RuntimeRule } from "@/features/mihomo-rules/types";

export function RuntimeRuleDetails({ rule, target, selecting, onSelectTarget }: { rule: RuntimeRule; target?: RuleTargetState; selecting: boolean; onSelectTarget?: (name: string) => void }) {
  const nodes: ProxyNodeView[] = target?.members.map((member) => ({
    key: member.name,
    name: member.name,
    type: member.type,
    kind: member.kind,
    delay: member.delay,
    alive: member.alive,
    providerName: member.providerName,
  })) ?? [];
  return (
    <div className="mx-2 mb-2 grid gap-3 border-t border-border/55 px-2 pb-1 pt-3 text-xs sm:grid-cols-2">
      <div className="min-w-0">
        <div className="text-muted-foreground">完整规则</div>
        <div className="mt-1 break-words font-mono leading-5 text-foreground">{rule.type}{rule.payload ? `,${rule.payload}` : ""}{rule.target && rule.target !== "-" ? `,${rule.target}` : ""}</div>
        <div className="mt-1 text-muted-foreground">原始顺序 #{rule.index}</div>
      </div>
      <div>
        <div className="text-muted-foreground">策略链</div>
        <div className="mt-1 break-words leading-5 text-foreground">{target?.chain?.length ? target.chain.join(" → ") : rule.target || "未指定"}</div>
        <div className="mt-1 text-muted-foreground">最终节点：<span className="text-foreground">{target?.finalNode || "未解析"}</span>{target?.delay ? ` · ${target.delay} ms` : ""}</div>
      </div>
      <div className="sm:col-span-2">
        {target?.cycleDetected ? (
          <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />检测到策略组循环，未继续解析。</p>
        ) : target?.missingReference ? (
          <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />策略引用 {target.missingReference} 不存在。</p>
        ) : null}
      </div>
      {nodes.length ? (
        <section className="min-w-0 border-t border-border/45 pt-3 sm:col-span-2" aria-label={`${target?.groupName ?? rule.target} 节点选择`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <div className="font-medium text-foreground">节点选择</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">当前 {target?.selectedName || "未选择"} · 选择后立即应用到运行内核</div>
            </div>
            {selecting ? <span className="inline-flex items-center gap-1 text-[11px] text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />切换中</span> : null}
          </div>
          <ProxyNodeGrid nodes={nodes} selectedKey={target?.selectedName} display="wrap" groupByProvider minCardWidth={120} cardSize="compact" onSelect={selecting || !onSelectTarget ? undefined : (node) => onSelectTarget(node.name)} />
        </section>
      ) : null}
    </div>
  );
}
