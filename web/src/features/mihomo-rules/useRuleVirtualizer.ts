import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

export const RULE_VIRTUALIZATION_THRESHOLD = 200;

export type VirtualRuleItem = { index: number; start: number; size: number };

export function shouldVirtualizeRules(count: number): boolean {
  return count > RULE_VIRTUALIZATION_THRESHOLD;
}
export function createVirtualWindow(count: number, scrollTop: number, viewportHeight: number, rowHeight = 64, overscan = 6): VirtualRuleItem[] {
  if (count <= 0) return [];
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
    const index = first + offset;
    return { index, start: index * rowHeight, size: rowHeight };
  });
}

export type RuleVirtualizer = {
  containerRef: RefObject<HTMLDivElement | null>;
  virtualItems: VirtualRuleItem[];
  totalSize: number;
  onItemResize(index: number, size: number): void;
};

export function useRuleVirtualizer(options: { count: number; enabled?: boolean; estimateSize?: number; overscan?: number }): RuleVirtualizer {
  const { count, enabled = true, estimateSize = 72, overscan = 6 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef(new Map<number, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const onScroll = () => setScrollTop(node.scrollTop);
    const updateSize = () => setViewportHeight(Math.max(240, node.clientHeight || 640));
    node.addEventListener("scroll", onScroll, { passive: true });
    updateSize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : undefined;
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, []);

  const { virtualItems, totalSize } = useMemo(() => {
    if (!enabled) return { virtualItems: Array.from({ length: count }, (_, index) => ({ index, start: 0, size: 0 })), totalSize: 0 };
    const positions: number[] = [];
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
      positions[index] = cursor;
      cursor += heightsRef.current.get(index) ?? estimateSize;
    }
    const first = Math.max(0, positions.findIndex((start, index) => start + (heightsRef.current.get(index) ?? estimateSize) >= scrollTop) - overscan);
    const safeFirst = first < 0 ? 0 : first;
    let last = safeFirst;
    while (last < count && positions[last] < scrollTop + viewportHeight) last += 1;
    const safeLast = Math.min(count - 1, last + overscan);
    const items = safeLast < safeFirst ? [] : Array.from({ length: safeLast - safeFirst + 1 }, (_, offset) => {
      const index = safeFirst + offset;
      return { index, start: positions[index], size: heightsRef.current.get(index) ?? estimateSize };
    });
    return { virtualItems: items, totalSize: cursor };
  }, [count, enabled, estimateSize, overscan, revision, scrollTop, viewportHeight]);

  const onItemResize = useCallback((index: number, size: number) => {
    if (!Number.isFinite(size) || size <= 0) return;
    const rounded = Math.ceil(size);
    if (heightsRef.current.get(index) === rounded) return;
    heightsRef.current.set(index, rounded);
    setRevision((value) => value + 1);
  }, []);

  return { containerRef, virtualItems, totalSize, onItemResize };
}
