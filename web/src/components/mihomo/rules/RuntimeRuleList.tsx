import type { RuleSearchMatcher } from "@/features/mihomo-rules/search";
import { ruleStableKey } from "@/features/mihomo-rules/selectors";
import { shouldVirtualizeRules, useRuleVirtualizer } from "@/features/mihomo-rules/useRuleVirtualizer";
import type { RuleStore, RuntimeRule } from "@/features/mihomo-rules/types";
import { RuleEmptyState } from "./RuleEmptyState";
import { RuntimeRuleRow } from "./RuntimeRuleRow";

export function RuntimeRuleList({
  rules,
  store,
  matcher,
  loading,
  expandedIds,
  onExpand,
  onToggle,
  disconnectMatched,
  selectingTargetName,
  onSelectTarget,
}: {
  rules: readonly RuntimeRule[];
  store: RuleStore;
  matcher: RuleSearchMatcher;
  loading: boolean;
  expandedIds: ReadonlySet<string>;
  onExpand: (id: string) => void;
  onToggle: (rule: RuntimeRule, disabled: boolean) => void;
  disconnectMatched: boolean;
  selectingTargetName?: string;
  onSelectTarget?: (groupName: string, nodeName: string) => void;
}) {
  const virtual = shouldVirtualizeRules(rules.length);
  const virtualizer = useRuleVirtualizer({ count: rules.length, enabled: virtual, estimateSize: 86, overscan: 8 });
  if (!rules.length) return <RuleEmptyState loading={loading} title={matcher.query ? "没有匹配的规则" : "暂无运行规则"} description={matcher.query ? "尝试减少关键词，或关闭正则搜索后再试。" : "请确认 Mihomo Controller 已启动并返回规则。"} />;
  const render = (rule: RuntimeRule, index: number, top?: number) => {
    const key = ruleStableKey(rule);
    const target = store.targets[rule.target];
    const row = (
      <RuntimeRuleRow
        rule={rule}
        target={target}
        matcher={matcher}
        expanded={expandedIds.has(key)}
        ruleToggle={store.capabilities.ruleToggle}
        disconnectMatched={disconnectMatched}
        onExpand={() => onExpand(key)}
        onToggle={(disabled) => onToggle(rule, disabled)}
        onResize={virtual ? (height) => virtualizer.onItemResize(index, height) : undefined}
        selectingTarget={selectingTargetName === target?.groupName}
        onSelectTarget={target?.members.length ? (nodeName) => onSelectTarget?.(target.groupName, nodeName) : undefined}
      />
    );
    return top === undefined ? <div key={key}>{row}</div> : <div key={key} className="absolute left-0 right-0" style={{ transform: `translateY(${top}px)` }}>{row}</div>;
  };
  if (!virtual) {
    return <div className="space-y-0.5" aria-label="运行规则列表">{rules.map((rule, index) => render(rule, index))}</div>;
  }
  return (
    <div ref={virtualizer.containerRef} className="max-h-[min(70vh,760px)] overflow-y-auto overscroll-contain pr-1" aria-label="运行规则虚拟列表">
      <div className="relative" style={{ height: `${virtualizer.totalSize}px` }}>
        {virtualizer.virtualItems.map((item) => render(rules[item.index], item.index, item.start))}
      </div>
    </div>
  );
}
