import { AlertTriangle, Search, SlidersHorizontal } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import type { RuleSearchMode } from "@/features/mihomo-rules/types";
import type { RefObject } from "react";

export type RulePageTab = "rules" | "providers" | "config";

export function RuleToolbar({
  tab,
  onTabChange,
  ruleCount,
  providerCount,
  query,
  onQueryChange,
  searchMode,
  onSearchModeChange,
  regexError,
  onFocusSearch,
  searchInputRef,
}: {
  tab: RulePageTab;
  onTabChange: (tab: RulePageTab) => void;
  ruleCount: number;
  providerCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  searchMode: RuleSearchMode;
  onSearchModeChange: (mode: RuleSearchMode) => void;
  regexError?: string;
  onFocusSearch: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <GlassSurface material="regular" flat className="p-2 md:p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <GlassSegmentedControl
          value={tab}
          onChange={onTabChange}
          ariaLabel="规则管理分页"
          className="w-full shrink-0 md:w-auto"
          options={[
            { id: "rules", label: <>规则 <span className="ml-1 text-xs opacity-70">{ruleCount}</span></> },
            { id: "providers", label: <>规则提供商 <span className="ml-1 text-xs opacity-70">{providerCount}</span></> },
            { id: "config", label: "配置编辑" },
          ]}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <GlassField
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              className="h-10 w-full pl-9 pr-3 text-sm"
              placeholder="搜索类型、规则内容、策略组或节点"
              aria-label="搜索规则"
            />
          </div>
          <GlassButton
            type="button"
            variant={searchMode === "regex" ? "primary" : "tool"}
            onClick={() => onSearchModeChange(searchMode === "regex" ? "plain" : "regex")}
            aria-pressed={searchMode === "regex"}
            aria-label={searchMode === "regex" ? "关闭正则搜索" : "开启正则搜索"}
            title="正则搜索最多 128 个字符，并拦截高风险表达式"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">正则</span>
          </GlassButton>
          <GlassButton type="button" variant="tool" onClick={onFocusSearch} aria-label="聚焦搜索框" title="聚焦搜索框">
            <Search className="h-4 w-4" aria-hidden="true" />
          </GlassButton>
        </div>
      </div>
      {regexError ? (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-destructive" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {regexError}
        </p>
      ) : null}
    </GlassSurface>
  );
}
