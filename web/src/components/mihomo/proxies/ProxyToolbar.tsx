import { Gauge, GripVertical, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";
import type { ProxySearchMode, ProxyTab } from "./types";

export function ProxyToolbar({
  tab,
  onTabChange,
  onTestAll,
  testingAll,
  groupCount,
  providerCount,
  mode,
  onModeChange,
  search,
  onSearchChange,
  searchMode,
  onSearchModeChange,
  regex,
  onRegexChange,
  regexError,
  sortBy,
  onSortChange,
  typeFilter,
  typeOptions,
  onTypeFilterChange,
  onSettings,
  reorderEnabled,
  onReorderToggle,
  onRestoreOrder,
}: {
  tab: ProxyTab;
  onTabChange: (value: ProxyTab) => void;
  onTestAll: () => void;
  testingAll?: boolean;
  groupCount: number;
  providerCount: number;
  mode: string;
  onModeChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchMode: ProxySearchMode;
  onSearchModeChange: (value: ProxySearchMode) => void;
  regex: boolean;
  onRegexChange: (value: boolean) => void;
  regexError?: string;
  sortBy: string;
  onSortChange: (value: string) => void;
  typeFilter: string;
  typeOptions: string[];
  onTypeFilterChange: (value: string) => void;
  onSettings: () => void;
  reorderEnabled: boolean;
  onReorderToggle: () => void;
  onRestoreOrder: () => void;
}) {
  return (
    <GlassSurface material="regular" flat className="space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GlassSegmentedControl
          value={tab}
          onChange={onTabChange}
          ariaLabel="代理视图"
          options={[
            { id: "groups", label: `策略组 ${groupCount}` },
            { id: "providers", label: `供应商 ${providerCount}` },
          ]}
          className="shrink-0"
        />
        <GlassSegmentedControl
          value={mode}
          onChange={onModeChange}
          ariaLabel="运行模式"
          options={[
            { id: "直连", label: "直连" },
            { id: "规则", label: "规则" },
            { id: "全局", label: "全局" },
          ]}
          className="shrink-0"
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onTestAll}
            disabled={testingAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-wait disabled:opacity-60"
            title="对所有唯一物理节点测速，每个节点只测一次"
          >
            {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
            全部测速
          </button>
          <button
            type="button"
            onClick={onReorderToggle}
            aria-pressed={reorderEnabled}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors", reorderEnabled ? "bg-primary/12 text-primary" : "bg-background/45 text-muted-foreground hover:text-foreground")}
            title="拖动策略组自定义排序，仅保存到本地"
          >
            <GripVertical className="h-4 w-4" />
            <span className="hidden sm:inline">自定义排序</span>
          </button>
          {reorderEnabled ? (
            <button type="button" onClick={onRestoreOrder} className="h-9 rounded-xl bg-background/45 px-3 text-xs text-muted-foreground hover:text-foreground">
              恢复配置顺序
            </button>
          ) : null}
          <button type="button" onClick={onSettings} className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-background/45 text-muted-foreground hover:text-foreground" title="显示设置">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <div className="relative min-w-[min(100%,260px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <GlassField
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchMode === "groups" ? "搜索策略组、类型或当前节点" : "全局节点搜索：节点 · 策略组 · Provider"}
            aria-label="搜索代理"
            className="h-10 w-full pl-9 pr-10"
          />
          {search ? (
            <button type="button" onClick={() => onSearchChange("")} className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="清空搜索">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          {regexError ? <p className="mt-1 text-xs text-destructive">{regexError}</p> : null}
        </div>
        <GlassSegmentedControl
          value={searchMode}
          onChange={onSearchModeChange}
          ariaLabel="搜索模式"
          options={[{ id: "groups", label: "分组" }, { id: "nodes", label: "全局节点" }]}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={() => onRegexChange(!regex)}
          aria-pressed={regex}
          className={cn("h-10 rounded-xl px-3 text-xs font-medium", regex ? "bg-primary/12 text-primary" : "bg-background/45 text-muted-foreground hover:text-foreground")}
          title="显式开启后才执行正则；最多 128 字符并拒绝危险表达式"
        >
          正则
        </button>
        <select value={sortBy} onChange={(event) => onSortChange(event.target.value)} className="h-10 rounded-xl bg-background/45 px-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30" aria-label="排序">
          <option value="default">配置顺序</option>
          <option value="name-asc">名称升序</option>
          <option value="name-desc">名称降序</option>
          <option value="delay-asc">延迟升序</option>
          <option value="delay-desc">延迟降序</option>
        </select>
        {tab === "groups" ? (
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className="h-10 rounded-xl bg-background/45 px-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30" aria-label="策略组类型">
            {typeOptions.map((option) => <option key={option} value={option}>{option === "all" ? "全部类型" : option}</option>)}
          </select>
        ) : null}
      </div>
    </GlassSurface>
  );
}
