import { CheckCircle2, CircleAlert, Clock3, Download, Loader2, Pencil } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import type { RuntimeRuleProvider } from "@/features/mihomo-rules/types";

function bytes(value?: number): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function updated(value?: string): string {
  if (!value) return "未更新";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : value;
}

export function RuleProviderCard({ provider, canEdit, canUpdate, onUpdate, onEdit }: { provider: RuntimeRuleProvider; canEdit: boolean; canUpdate: boolean; onUpdate: () => void; onEdit: () => void }) {
  const failed = Boolean(provider.lastUpdateError);
  return (
    <SolidPlate tone="regular" className="min-w-0 w-full max-w-full overflow-hidden p-3 sm:p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
        <div className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground" title={provider.name}>{provider.name}</h3>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{provider.type}</span>
            {provider.behavior ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{provider.behavior}</span> : null}
            {provider.usingStaleCache ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">使用旧缓存</span> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={provider.url || provider.path}>{provider.url || provider.path || "未配置来源"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <GlassButton type="button" variant="tool" className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-2.5" onClick={onUpdate} disabled={!canUpdate || provider.updating || !provider.name} aria-label={`更新规则提供商 ${provider.name}`} title={canUpdate ? "只更新此规则提供商" : "不受当前内核支持"}>
            {provider.updating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">更新</span>
          </GlassButton>
          {canEdit ? <GlassButton type="button" variant="tool" className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-2.5" onClick={onEdit} aria-label={`编辑规则提供商 ${provider.name}`} title="编辑此规则提供商"><Pencil className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">编辑</span></GlassButton> : null}
        </div>
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
        <div className="min-w-0"><span className="block text-[11px]">规则数量</span><strong className="tabular-nums text-foreground">{provider.ruleCount ?? "—"}</strong></div>
        <div className="min-w-0"><span className="block text-[11px]">大小</span><strong className="tabular-nums text-foreground">{bytes(provider.size)}</strong></div>
        <div className="min-w-0"><span className="block text-[11px]">更新时间</span><strong className="block truncate text-foreground" title={provider.updatedAt}>{updated(provider.updatedAt)}</strong></div>
        <div className="min-w-0"><span className="block text-[11px]">状态</span><strong className={failed ? "flex items-center gap-1 text-red-700 dark:text-red-300" : "flex items-center gap-1 text-emerald-700 dark:text-emerald-300"}>{failed ? <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}{failed ? "更新失败" : provider.updating ? "更新中" : "可用"}</strong></div>
      </div>
      {failed ? <p className="mt-2 flex items-start gap-1 text-xs leading-5 text-red-700 dark:text-red-300"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />更新失败，正在使用旧缓存：{provider.lastUpdateError}</p> : null}
    </SolidPlate>
  );
}
