import { Activity, ChevronDown, ChevronRight, Edit3, Loader2, RefreshCw } from "lucide-react";
import { memo } from "react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";
import { ProxyNodeGrid } from "./ProxyNodeGrid";
import type { ProxyCardSize, ProxyNodeDisplay, ProxyNodeView, ProxyProviderView } from "./types";

function ProxyProviderCardComponent({
  provider,
  collapsed,
  testing,
  testingKeys,
  updating,
  hideUnavailable,
  nodeDisplay,
  minCardWidth,
  cardSize,
  disableTextSelect,
  low,
  high,
  onToggle,
  onTest,
  onUpdate,
  onEdit,
}: {
  provider: ProxyProviderView;
  collapsed: boolean;
  testing?: string | null;
  testingKeys?: ReadonlySet<string>;
  updating?: boolean;
  hideUnavailable?: boolean;
  nodeDisplay?: ProxyNodeDisplay;
  minCardWidth?: number;
  cardSize?: ProxyCardSize;
  disableTextSelect?: boolean;
  low?: number;
  high?: number;
  onToggle: () => void;
  onTest: (node?: ProxyNodeView) => void;
  onUpdate: () => void;
  onEdit?: () => void;
}) {
  const alive = provider.alive ?? provider.nodes.filter((node) => node.alive !== false).length;
  const total = provider.total ?? provider.nodes.length;
  const percent = Math.min(100, Math.max(0, Number(provider.percent) || 0));
  return (
    <GlassSurface material="regular" className={cn("min-w-0 overflow-hidden p-0", disableTextSelect && "select-none")} data-proxy-card-material="classic-glass">
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45" aria-expanded={!collapsed} aria-label={collapsed ? `展开供应商 ${provider.name}` : `收起供应商 ${provider.name}`}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Activity className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold" title={provider.name}>{provider.name}</h2><span className="text-[11px] tabular-nums text-muted-foreground">{alive}/{total} 存活</span>{provider.stale ? <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">更新失败，使用旧缓存</span> : null}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground"><span>{provider.used || "-"} / {provider.quota || "-"}</span>{provider.expire ? <span>{provider.expire}</span> : null}{provider.updated ? <span>{provider.updated}</span> : null}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/55"><div className="h-full rounded-full bg-primary/75 transition-[width] duration-350" style={{ width: `${percent}%` }} /></div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onUpdate} disabled={updating} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:opacity-50" title="在线更新供应商缓存" aria-label={`更新 ${provider.name}`}><RefreshCw className={cn("h-3.5 w-3.5", updating && "animate-spin")} /></button>
          {onEdit ? <button type="button" onClick={onEdit} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45" title="编辑供应商" aria-label={`编辑 ${provider.name}`}><Edit3 className="h-4 w-4" /></button> : null}
        </div>
      </div>
      {!collapsed ? <div className="px-3 pb-3"><ProxyNodeGrid nodes={provider.nodes} hideUnavailable={hideUnavailable} display={nodeDisplay} minCardWidth={minCardWidth} cardSize={cardSize} disableTextSelect={disableTextSelect} low={low} high={high} testingKey={testing} testingKeys={testingKeys} onTest={(node) => onTest(node)} /></div> : null}
      {testing === provider.id ? <div className="flex items-center gap-2 px-4 pb-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在健康检查…</div> : null}
    </GlassSurface>
  );
}

type ProxyProviderCardProps = Parameters<typeof ProxyProviderCardComponent>[0];

function providerTestingSignature({ provider, testing, testingKeys }: ProxyProviderCardProps): string {
  const active: string[] = [];
  const matches = (key?: string) => Boolean(key && (testing === key || testingKeys?.has(key)));
  if (matches(provider.id) || matches(provider.name)) active.push(provider.id);
  provider.nodes.forEach((node) => {
    if (matches(node.key) || matches(node.name)) active.push(node.key);
  });
  return active.join("\u0000");
}

function proxyProviderCardEqual(previous: ProxyProviderCardProps, next: ProxyProviderCardProps): boolean {
  return previous.provider === next.provider
    && previous.collapsed === next.collapsed
    && previous.updating === next.updating
    && previous.hideUnavailable === next.hideUnavailable
    && previous.nodeDisplay === next.nodeDisplay
    && previous.minCardWidth === next.minCardWidth
    && previous.cardSize === next.cardSize
    && previous.disableTextSelect === next.disableTextSelect
    && previous.low === next.low
    && previous.high === next.high
    && Boolean(previous.onEdit) === Boolean(next.onEdit)
    && (previous.testingKeys === next.testingKeys || providerTestingSignature(previous) === providerTestingSignature(next));
}

export const ProxyProviderCard = memo(ProxyProviderCardComponent, proxyProviderCardEqual);
