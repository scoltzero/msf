import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Layers3 } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";
import { ProxyNodeCard } from "./ProxyNodeCard";
import type { ProxyCardSize, ProxyNodeDisplay, ProxyNodeView } from "./types";

const INITIAL_NODES = 24;
const CHUNK_SIZE = 24;

export function ProxyNodeGrid({
  nodes,
  selectedKey,
  hideUnavailable,
  display,
  groupByProvider = false,
  minCardWidth = 145,
  cardSize = "comfortable",
  disableTextSelect = false,
  low,
  high,
  testingKey,
  testingKeys,
  onSelect,
  onTest,
}: {
  nodes: ProxyNodeView[];
  selectedKey?: string;
  hideUnavailable?: boolean;
  display?: ProxyNodeDisplay;
  groupByProvider?: boolean;
  minCardWidth?: number;
  cardSize?: ProxyCardSize;
  disableTextSelect?: boolean;
  low?: number;
  high?: number;
  testingKey?: string | null;
  testingKeys?: ReadonlySet<string>;
  onSelect?: (node: ProxyNodeView) => void;
  onTest?: (node: ProxyNodeView) => void;
}) {
  const [limit, setLimit] = useState(INITIAL_NODES);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { visibleNodes, filteredCount } = useMemo(() => {
    const filtered = hideUnavailable ? nodes.filter((node) => node.alive !== false && Number(node.delay) > 0) : nodes;
    const selected = nodes.find((node) => node.key === selectedKey || node.name === selectedKey);
    const first = filtered.slice(0, limit);
    if (selected && !first.some((node) => node.key === selected.key)) first.push(selected);
    return { visibleNodes: first, filteredCount: filtered.length };
  }, [hideUnavailable, limit, nodes, selectedKey]);

  const groups = useMemo(() => {
    if (!groupByProvider) return [{ name: "", nodes: visibleNodes }];
    const buckets = new Map<string, ProxyNodeView[]>();
    visibleNodes.forEach((node) => {
      const name = node.kind === "group" ? "策略组" : node.providerName || "自定义与内置节点";
      const bucket = buckets.get(name);
      if (bucket) bucket.push(node);
      else buckets.set(name, [node]);
    });
    return Array.from(buckets, ([name, groupedNodes]) => ({ name, nodes: groupedNodes }));
  }, [groupByProvider, visibleNodes]);

  useEffect(() => setLimit(INITIAL_NODES), [nodes.length, hideUnavailable]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || limit >= filteredCount || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => Math.min(value + CHUNK_SIZE, filteredCount));
    }, { rootMargin: "320px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredCount, limit]);

  if (visibleNodes.length === 0) return <div className="rounded-xl bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">没有符合条件的节点</div>;

  const safeMinWidth = Math.max(96, Math.min(640, Number(minCardWidth) || 145));
  const gridStyle = {
    "--proxy-node-min-width": `${safeMinWidth}px`,
    gridTemplateColumns: "repeat(auto-fill, minmax(min(var(--proxy-node-min-width), 100%), 1fr))",
  } as CSSProperties;
  const renderNodes = (items: ProxyNodeView[]) => (
    <div className={cn("grid", cardSize === "compact" ? "gap-1" : "gap-2")} style={gridStyle}>
      {items.map((node) => (
        <ProxyNodeCard
          key={node.key}
          node={node}
          active={node.key === selectedKey || node.name === selectedKey}
          testing={Boolean(testingKeys?.has(node.key) || testingKeys?.has(node.name) || testingKey === node.key || testingKey === node.name)}
          display={display}
          cardSize={cardSize}
          disableTextSelect={disableTextSelect}
          low={low}
          high={high}
          onSelect={onSelect ? () => onSelect(node) : undefined}
          onTest={onTest ? () => onTest(node) : undefined}
        />
      ))}
    </div>
  );

  return (
    <SolidPlate
      tone="subtle"
      className={cn(cardSize === "compact" ? "space-y-2 p-1.5" : "space-y-3 p-2", disableTextSelect && "select-none")}
      style={{ contentVisibility: "auto", containIntrinsicSize: "240px" }}
    >
      {groups.map((group) => (
        <section key={group.name || "all"} className={cn("min-w-0", cardSize === "compact" ? "space-y-1" : "space-y-2")}>
          {groupByProvider ? (
            <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" />
              <span className="truncate">{group.name}</span>
              <span className="tabular-nums">{group.nodes.length}</span>
            </h3>
          ) : null}
          {renderNodes(group.nodes)}
        </section>
      ))}
      {limit < filteredCount ? <div ref={sentinelRef} className="h-1" aria-hidden="true" /> : null}
    </SolidPlate>
  );
}
