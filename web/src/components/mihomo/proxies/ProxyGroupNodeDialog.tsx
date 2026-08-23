import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { ProxyNodeGrid } from "./ProxyNodeGrid";
import type { ProxyCardSize, ProxyGroupView, ProxyNodeDisplay, ProxyNodeView } from "./types";

export function ProxyGroupNodeDialog({
  open,
  group,
  testing,
  testingKeys,
  hideUnavailable,
  nodeDisplay,
  groupByProvider,
  minCardWidth,
  cardSize,
  disableTextSelect,
  low,
  high,
  onSelect,
  onTest,
  onClose,
}: {
  open: boolean;
  group: ProxyGroupView | null;
  testing?: string | null;
  testingKeys?: ReadonlySet<string>;
  hideUnavailable?: boolean;
  nodeDisplay?: ProxyNodeDisplay;
  groupByProvider?: boolean;
  minCardWidth?: number;
  cardSize?: ProxyCardSize;
  disableTextSelect?: boolean;
  low?: number;
  high?: number;
  onSelect: (node: ProxyNodeView) => void;
  onTest: (node: ProxyNodeView) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !group) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previous?.focus();
    };
  }, [group, open]);

  if (!open || !group) return null;

  const titleId = `proxy-group-node-dialog-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const selected = group.selectedName || group.selectedKey || "未选择";

  return (
    <ModalViewport onClose={onClose}>
      <GlassDialog
        className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:h-[min(88dvh,52rem)] sm:w-[calc(100vw-2rem)]"
        onClick={(event) => event.stopPropagation()}
        aria-labelledby={titleId}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border/45 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-semibold text-foreground">{group.name} · 节点</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">当前 {selected} · {group.nodes.length} 个节点</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/45 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45" aria-label="关闭节点弹层" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
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
            onSelect={(node) => { onSelect(node); onClose(); }}
            onTest={onTest}
          />
        </div>
        <footer className="flex shrink-0 justify-end border-t border-border/45 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
          <GlassButton type="button" onClick={onClose} className="h-9 px-3 text-xs">关闭</GlassButton>
        </footer>
      </GlassDialog>
    </ModalViewport>
  );
}
