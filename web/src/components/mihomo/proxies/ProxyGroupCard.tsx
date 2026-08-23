import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  Gauge,
  GitBranch,
  Loader2,
  LockKeyhole,
  Waypoints,
} from "lucide-react";
import { memo, type ReactNode } from "react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ProxyNodeGrid } from "./ProxyNodeGrid";
import { ProxyNodePreview } from "./ProxyNodePreview";
import type {
  ProxyCardSize,
  ProxyGroupView,
  ProxyNodeDisplay,
  ProxyPreviewType,
} from "./types";

function delayTextTone(delay: number, low: number, high: number) {
  if (delay <= 0) return "text-muted-foreground";
  if (delay < low) return "text-emerald-600 dark:text-emerald-300";
  if (delay < high) return "text-amber-600 dark:text-amber-300";
  return "text-red-600 dark:text-red-300";
}

export function proxyGroupManagementActionsVisible(embedded: boolean) {
  return !embedded;
}

function ProxyGroupCardComponent({
  group,
  collapsed,
  testing,
  testingKeys,
  hideUnavailable,
  nodeDisplay,
  previewType = "auto",
  groupByProvider = false,
  minCardWidth = 145,
  cardSize = "comfortable",
  groupIconSize = 24,
  groupIconMargin = 12,
  displayFinalOutbound = false,
  disableTextSelect = false,
  manageHiddenGroups = false,
  nodeDialogMode = false,
  embedded = false,
  low,
  high,
  onToggle,
  onOpenNodes,
  onToggleHidden,
  onSelect,
  onTest,
  onChain,
  onEdit,
  reorderEnabled,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  group: ProxyGroupView;
  collapsed: boolean;
  testing?: string | null;
  testingKeys?: ReadonlySet<string>;
  hideUnavailable?: boolean;
  nodeDisplay?: ProxyNodeDisplay;
  previewType?: ProxyPreviewType;
  groupByProvider?: boolean;
  minCardWidth?: number;
  cardSize?: ProxyCardSize;
  groupIconSize?: number;
  groupIconMargin?: number;
  displayFinalOutbound?: boolean;
  disableTextSelect?: boolean;
  manageHiddenGroups?: boolean;
  nodeDialogMode?: boolean;
  /** Reuse the complete card anatomy inside a parent surface (for example a Dashboard card). */
  embedded?: boolean;
  low?: number;
  high?: number;
  onToggle: () => void;
  onOpenNodes?: () => void;
  onToggleHidden?: () => void;
  onSelect: (node: ProxyGroupView["nodes"][number]) => void;
  onTest: (node?: ProxyGroupView["nodes"][number]) => void;
  onChain?: () => void;
  onEdit?: () => void;
  reorderEnabled?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: () => void;
}) {
  const selected = group.selectedName || group.selectedKey || "未选择";
  const selectedIndex = group.nodes.findIndex((node) => node.key === group.selectedKey || node.name === group.selectedName);
  const delay = Number(group.delay) || 0;
  const trafficSpeed = Math.max(0, Number(group.trafficSpeed) || 0);
  const isTesting = Boolean(testing === group.key || testing === group.name || testingKeys?.has(group.key) || testingKeys?.has(group.name));
  const iconSize = Math.max(12, Math.min(64, Number(groupIconSize) || 24));
  const iconMargin = Math.max(0, Math.min(32, Number(groupIconMargin) || 0));
  const disclosureAction = nodeDialogMode ? (onOpenNodes ?? onToggle) : onToggle;
  const resolvedCollapsed = nodeDialogMode || collapsed;
  const showFinalOutbound = Boolean(
    displayFinalOutbound &&
    group.finalOutboundName &&
    group.finalOutboundName !== selected,
  );
  const managementActions = proxyGroupManagementActionsVisible(embedded) ? (
    <>
      {onChain ? <button type="button" onClick={onChain} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45" title="查看节点链路" aria-label={`查看 ${group.name} 节点链路`}><GitBranch className="h-4 w-4" /></button> : null}
      {manageHiddenGroups && onToggleHidden ? <button type="button" onClick={onToggleHidden} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45" title={group.userHidden ? "取消用户隐藏" : "用户隐藏该策略组"} aria-label={group.userHidden ? `取消隐藏 ${group.name}` : `隐藏 ${group.name}`}>{group.userHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button> : null}
      {onEdit ? <button type="button" onClick={onEdit} disabled={group.readOnly} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-40" title={group.readOnly ? "默认配置中的策略组只读" : "编辑策略组"} aria-label={group.readOnly ? `${group.name} 为只读策略组` : `编辑策略组 ${group.name}`}><Edit3 className="h-4 w-4" /></button> : null}
    </>
  ) : null;

  const content: ReactNode = (
    <>

      <div className="flex min-w-0 items-start gap-0 px-4 py-3">
        <button
          type="button"
          onClick={disclosureAction}
          className="mr-2.5 mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
          aria-expanded={nodeDialogMode ? undefined : !resolvedCollapsed}
          aria-haspopup={nodeDialogMode ? "dialog" : undefined}
          aria-label={nodeDialogMode ? `查看 ${group.name} 的节点` : resolvedCollapsed ? `展开 ${group.name}` : `折叠 ${group.name}`}
        >
          {nodeDialogMode || resolvedCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <div
          className="mt-0.5 flex shrink-0 items-center justify-center text-primary"
          style={{ width: iconSize, height: iconSize, marginRight: iconMargin }}
          aria-hidden="true"
        >
          {group.icon ? (
            <img src={group.icon} alt="" className="h-full w-full rounded object-contain" referrerPolicy="no-referrer" />
          ) : (
            <Waypoints style={{ width: iconSize, height: iconSize }} strokeWidth={1.8} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-sm font-semibold text-foreground" title={group.name}>{group.name}</h2>
            <span className="rounded-full bg-background/35 px-2 py-0.5 text-[11px] text-muted-foreground">{group.type || "Selector"}</span>
            {group.readOnly ? <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><LockKeyhole className="h-3 w-3" />只读</span> : null}
            {group.userHidden ? <span className="text-[11px] text-muted-foreground">用户隐藏</span> : null}
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {selectedIndex >= 0 ? `${selectedIndex + 1}/${group.nodes.length}` : `${group.nodes.length} 节点`}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">当前</span>
            {group.selectedIcon ? <img src={group.selectedIcon} alt="" className="h-3.5 w-3.5 shrink-0 rounded object-contain" referrerPolicy="no-referrer" /> : null}
            <span className="min-w-0 truncate font-medium text-foreground/85" title={selected}>{selected}</span>
            {showFinalOutbound ? (
              <>
                <span aria-hidden="true">→</span>
                {group.finalOutboundIcon ? <img src={group.finalOutboundIcon} alt="" className="h-3.5 w-3.5 shrink-0 rounded object-contain" referrerPolicy="no-referrer" /> : null}
                <span className="min-w-0 truncate" title={group.finalOutboundName}>{group.finalOutboundName}</span>
              </>
            ) : null}
            <span className="ml-auto shrink-0 tabular-nums">{formatBytes(trafficSpeed)}/s</span>
          </div>

          {resolvedCollapsed ? (
            <ProxyNodePreview
              nodes={group.nodes}
              selectedKey={group.selectedKey || group.selectedName}
              type={previewType}
              hideUnavailable={hideUnavailable}
              low={low}
              high={high}
            />
          ) : null}
        </div>

        <div className="ml-2.5 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onTest()}
            disabled={isTesting}
            className={cn(
              "inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-transparent px-1 text-xs font-semibold tabular-nums hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:opacity-50",
              delayTextTone(delay, low ?? 400, high ?? 800),
            )}
            title={delay > 0 ? `${group.name} 当前延迟 ${delay}ms，点击重新测速` : `测试 ${group.name} 延迟`}
            aria-label={delay > 0 ? `${group.name} 延迟 ${delay} 毫秒，点击重新测速` : `测试 ${group.name} 延迟`}
          >
            {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : delay > 0 ? delay : <Gauge className="h-3.5 w-3.5" />}
          </button>
          {managementActions}
        </div>
      </div>

      {!resolvedCollapsed ? (
        <div className="px-3 pb-3">
          <ProxyNodeGrid
            nodes={group.nodes}
            selectedKey={group.selectedKey || group.selectedName}
            hideUnavailable={hideUnavailable}
            display={nodeDisplay}
            groupByProvider={groupByProvider}
            minCardWidth={minCardWidth}
            cardSize={cardSize}
            disableTextSelect={disableTextSelect}
            low={low}
            high={high}
            testingKey={testing}
            testingKeys={testingKeys}
            onSelect={onSelect}
            onTest={(node) => onTest(node)}
          />
        </div>
      ) : null}
    </>
  );

  const surfaceClassName = cn(
    "min-w-0 overflow-hidden rounded-2xl p-0 transition-[box-shadow,transform,opacity] duration-250",
    embedded ? "w-full self-stretch" : "self-start",
    reorderEnabled && "cursor-grab active:cursor-grabbing",
    disableTextSelect && "select-none",
    group.userHidden && "opacity-65",
  );

  if (embedded) {
    return (
      <div
        className={surfaceClassName}
        data-proxy-group-card="embedded"
        draggable={reorderEnabled}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {content}
      </div>
    );
  }

  return (
    <GlassSurface
      material="regular"
      className={surfaceClassName}
      data-proxy-card-material="classic-glass"
      draggable={reorderEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {content}
    </GlassSurface>
  );
}

type ProxyGroupCardProps = Parameters<typeof ProxyGroupCardComponent>[0];

function testingSignature({ group, testing, testingKeys }: ProxyGroupCardProps): string {
  const active: string[] = [];
  const matches = (key?: string) => Boolean(key && (testing === key || testingKeys?.has(key)));
  if (matches(group.key) || matches(group.name)) active.push(group.key);
  group.nodes.forEach((node) => {
    if (matches(node.key) || matches(node.name)) active.push(node.key);
  });
  return active.join("\u0000");
}

function proxyGroupCardEqual(previous: ProxyGroupCardProps, next: ProxyGroupCardProps): boolean {
  return previous.group === next.group
    && previous.collapsed === next.collapsed
    && previous.hideUnavailable === next.hideUnavailable
    && previous.nodeDisplay === next.nodeDisplay
    && previous.previewType === next.previewType
    && previous.groupByProvider === next.groupByProvider
    && previous.minCardWidth === next.minCardWidth
    && previous.cardSize === next.cardSize
    && previous.groupIconSize === next.groupIconSize
    && previous.groupIconMargin === next.groupIconMargin
    && previous.displayFinalOutbound === next.displayFinalOutbound
    && previous.disableTextSelect === next.disableTextSelect
    && previous.manageHiddenGroups === next.manageHiddenGroups
    && previous.nodeDialogMode === next.nodeDialogMode
    && previous.embedded === next.embedded
    && previous.low === next.low
    && previous.high === next.high
    && previous.reorderEnabled === next.reorderEnabled
    && Boolean(previous.onOpenNodes) === Boolean(next.onOpenNodes)
    && Boolean(previous.onToggleHidden) === Boolean(next.onToggleHidden)
    && Boolean(previous.onChain) === Boolean(next.onChain)
    && Boolean(previous.onEdit) === Boolean(next.onEdit)
    && (previous.testingKeys === next.testingKeys || testingSignature(previous) === testingSignature(next));
}

export const ProxyGroupCard = memo(ProxyGroupCardComponent, proxyGroupCardEqual);
