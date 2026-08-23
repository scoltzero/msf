import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProxyNodeView, ProxyPreviewType } from "./types";

function previewTone(node: ProxyNodeView, low: number, high: number): string {
  const delay = Math.max(0, Number(node.delay) || 0);
  if (node.alive === false) return "bg-red-400/85 dark:bg-red-400/75";
  if (delay <= 0) return "bg-muted-foreground/35";
  if (delay < low) return "bg-emerald-500/75 dark:bg-emerald-400/70";
  if (delay < high) return "bg-amber-400/85 dark:bg-amber-300/75";
  return "bg-red-500/80 dark:bg-red-400/75";
}

function selectedNode(node: ProxyNodeView, selectedKey?: string): boolean {
  return node.key === selectedKey || node.name === selectedKey;
}

export function ProxyNodePreview({
  nodes,
  selectedKey,
  type = "auto",
  hideUnavailable = false,
  low = 400,
  high = 800,
}: {
  nodes: ProxyNodeView[];
  selectedKey?: string;
  type?: ProxyPreviewType;
  hideUnavailable?: boolean;
  low?: number;
  high?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const visibleNodes = useMemo(() => {
    const filtered = hideUnavailable
      ? nodes.filter((node) => node.alive !== false && Number(node.delay) > 0)
      : nodes;
    const selected = nodes.find((node) => selectedNode(node, selectedKey));
    if (selected && !filtered.some((node) => node.key === selected.key)) return [selected, ...filtered];
    return filtered;
  }, [hideUnavailable, nodes, selectedKey]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (visibleNodes.length === 0) return null;
  const resolvedType = type === "auto"
    ? (visibleNodes.length <= 24 && visibleNodes.length * 14 <= Math.max(width, 180) ? "dots" : "bar")
    : type;

  return (
    <div ref={containerRef} className="mt-2 min-w-0" aria-label={`${visibleNodes.length} 个节点的延迟预览`}>
      {resolvedType === "dots" ? (
        <div className="flex min-w-0 flex-wrap gap-1.5" role="img">
          {visibleNodes.slice(0, 50).map((node) => (
            <span
              key={node.key}
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                previewTone(node, low, high),
                selectedNode(node, selectedKey) && "ring-2 ring-primary/70 ring-offset-1 ring-offset-background/40",
              )}
              title={`${node.name} · ${Number(node.delay) > 0 ? `${node.delay}ms` : "未测速"}`}
            />
          ))}
          {visibleNodes.length > 50 ? <span className="text-[10px] tabular-nums text-muted-foreground">+{visibleNodes.length - 50}</span> : null}
        </div>
      ) : (
        <div className="flex h-1.5 min-w-0 overflow-hidden rounded-full bg-muted/55" role="img">
          {visibleNodes.map((node) => (
            <span
              key={node.key}
              className={cn("min-w-px flex-1", previewTone(node, low, high), selectedNode(node, selectedKey) && "ring-1 ring-inset ring-primary")}
              title={`${node.name} · ${Number(node.delay) > 0 ? `${node.delay}ms` : "未测速"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
