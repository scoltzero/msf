import { useRef, useState } from "react";
import { ProxyEmptyState } from "./ProxyEmptyState";
import { ProxyGroupCard } from "./ProxyGroupCard";
import { ProxyGroupNodeDialog } from "./ProxyGroupNodeDialog";
import { splitProxyItems, useResponsiveProxyColumns } from "./useResponsiveProxyColumns";
import type { ProxyCardSize, ProxyGroupView, ProxyNodeDisplay, ProxyPreviewType } from "./types";

export function ProxyGroupList({
  groups,
  loading,
  collapsed,
  onToggle,
  testing,
  testingKeys,
  hideUnavailable,
  nodeDisplay,
  previewType,
  groupByProvider,
  minCardWidth,
  cardSize,
  groupIconSize,
  groupIconMargin,
  displayFinalOutbound,
  disableTextSelect,
  manageHiddenGroups,
  low,
  high,
  onSelect,
  onTest,
  onChain,
  onEdit,
  onToggleHidden,
  reorderEnabled,
  onMove,
  doubleColumn = true,
}: {
  groups: ProxyGroupView[];
  loading?: boolean;
  collapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
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
  low?: number;
  high?: number;
  onSelect: (group: ProxyGroupView, node: ProxyGroupView["nodes"][number]) => void;
  onTest: (group: ProxyGroupView, node?: ProxyGroupView["nodes"][number]) => void;
  onChain: (group: ProxyGroupView) => void;
  onEdit: (group: ProxyGroupView) => void;
  onToggleHidden?: (group: ProxyGroupView) => void;
  reorderEnabled?: boolean;
  onMove?: (fromKey: string, toKey: string) => void;
  doubleColumn?: boolean;
}) {
  const dragKeyRef = useRef<string | null>(null);
  const [nodeDialogGroup, setNodeDialogGroup] = useState<ProxyGroupView | null>(null);
  const { containerRef, isSplit, isNodeDialogMode } = useResponsiveProxyColumns(doubleColumn);
  const [leftGroups, rightGroups] = splitProxyItems(groups, isSplit);

  const renderGroup = (group: ProxyGroupView) => {
    const cardCollapsed = collapsed(group.key);
    return (
      <div
        key={group.key}
        className="min-w-0"
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 156px" }}
      >
        <ProxyGroupCard
          group={group}
          collapsed={cardCollapsed}
          testing={testing}
          testingKeys={testingKeys}
          hideUnavailable={hideUnavailable}
          nodeDisplay={nodeDisplay}
          previewType={previewType}
          groupByProvider={groupByProvider}
          minCardWidth={minCardWidth}
          cardSize={cardSize}
          groupIconSize={groupIconSize}
          groupIconMargin={groupIconMargin}
          displayFinalOutbound={displayFinalOutbound}
          disableTextSelect={disableTextSelect}
          manageHiddenGroups={manageHiddenGroups}
          nodeDialogMode={isNodeDialogMode}
          low={low}
          high={high}
          onToggle={() => onToggle(group.key)}
          onOpenNodes={() => setNodeDialogGroup(group)}
          onToggleHidden={onToggleHidden ? () => onToggleHidden(group) : undefined}
          onSelect={(node) => onSelect(group, node)}
          onTest={(node) => onTest(group, node)}
          onChain={() => onChain(group)}
          onEdit={() => onEdit(group)}
          reorderEnabled={reorderEnabled}
          onDragStart={() => { dragKeyRef.current = group.key; }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            const dragKey = dragKeyRef.current;
            if (dragKey && dragKey !== group.key) onMove?.(dragKey, group.key);
            dragKeyRef.current = null;
          }}
        />
      </div>
    );
  };

  const content = loading && groups.length === 0
    ? (
      <div className={isSplit ? "flex items-start gap-3" : "flex flex-col gap-3"}>
        {(isSplit ? [0, 1] : [0]).map((columnIndex) => (
          <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="h-44 rounded-3xl bg-background/45" />
          </div>
        ))}
      </div>
    )
    : groups.length === 0
      ? <ProxyEmptyState kind="groups" />
      : (
        <div className={isSplit ? "flex items-start gap-3" : "flex flex-col gap-3"}>
          <div className="flex min-w-0 flex-1 flex-col gap-3">{leftGroups.map(renderGroup)}</div>
          {isSplit ? <div className="flex min-w-0 flex-1 flex-col gap-3">{rightGroups.map(renderGroup)}</div> : null}
        </div>
      );

  return (
    <>
      <div
        ref={containerRef}
        className={disableTextSelect ? "min-w-0 select-none" : "min-w-0"}
        data-proxy-card-list
        data-proxy-columns={isSplit ? "double" : "single"}
      >
        {content}
      </div>
      <ProxyGroupNodeDialog
        open={Boolean(nodeDialogGroup)}
        group={nodeDialogGroup}
        testing={testing}
        testingKeys={testingKeys}
        hideUnavailable={hideUnavailable}
        nodeDisplay={nodeDisplay}
        groupByProvider={groupByProvider}
        minCardWidth={minCardWidth}
        cardSize={cardSize}
        disableTextSelect={disableTextSelect}
        low={low}
        high={high}
        onSelect={(node) => { if (nodeDialogGroup) onSelect(nodeDialogGroup, node); }}
        onTest={(node) => { if (nodeDialogGroup) onTest(nodeDialogGroup, node); }}
        onClose={() => setNodeDialogGroup(null)}
      />
    </>
  );
}
