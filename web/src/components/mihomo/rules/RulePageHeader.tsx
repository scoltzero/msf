import { RefreshCw, Shield } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { configModeDescription, configModeLabel } from "@/features/mihomo-rules/configAuthority";
import type { RuleConfigAuthority } from "@/features/mihomo-rules/types";

export function RulePageHeader({
  ruleCount,
  providerCount,
  authority,
  fetchedAt,
  loading,
  refreshing,
  onRefresh,
}: {
  ruleCount: number;
  providerCount: number;
  authority: RuleConfigAuthority;
  fetchedAt: number;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const updated = fetchedAt ? new Date(fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "尚未同步";
  return (
    <WorkbenchHeader
      icon={Shield}
      title="规则管理"
      description={<>运行配置 <code className="font-mono">{authority.runtimePath || "configs/mihomo/config.yaml"}</code> · {configModeDescription(authority)}</>}
      status={<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{configModeLabel(authority)}</span>}
      actions={(
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">规则 <strong className="text-foreground">{ruleCount}</strong></span>
          <span className="tabular-nums">规则提供商 <strong className="text-foreground">{providerCount}</strong></span>
          <span className="hidden sm:inline">更新 {updated}</span>
          <GlassButton type="button" variant="tool" onClick={onRefresh} disabled={loading} aria-label="刷新规则运行态" title={refreshing ? "后台刷新中" : "刷新规则运行态"}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
          </GlassButton>
        </div>
      )}
    />
  );
}
