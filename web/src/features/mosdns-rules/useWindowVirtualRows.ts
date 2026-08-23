import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { calculateVirtualRange, type VirtualRange } from "./ruleListVirtualization";

type WindowVirtualRowsOptions = {
  count: number;
  rowHeight: number;
  overscan?: number;
};

export type WindowVirtualRows = VirtualRange & {
  containerRef: RefObject<HTMLDivElement | null>;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  refresh(): void;
};

export function useWindowVirtualRows({ count, rowHeight, overscan = 10 }: WindowVirtualRowsOptions): WindowVirtualRows {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [range, setRange] = useState<VirtualRange>(() => ({ start: 0, end: Math.min(count, overscan * 2 + 1) }));

  const updateRange = useCallback(() => {
    frameRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextRange = calculateVirtualRange({
      count,
      rowHeight,
      listTop: window.scrollY + rect.top,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      overscan,
    });
    setRange((current) => current.start === nextRange.start && current.end === nextRange.end ? current : nextRange);
  }, [count, overscan, rowHeight]);

  const refresh = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(updateRange);
  }, [updateRange]);

  useLayoutEffect(() => {
    updateRange();
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    if (containerRef.current) observer?.observe(containerRef.current);

    return () => {
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      observer?.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [refresh, updateRange]);

  const safeStart = Math.min(range.start, count);
  const safeEnd = Math.max(safeStart, Math.min(range.end, count));
  return {
    containerRef,
    start: safeStart,
    end: safeEnd,
    topSpacerHeight: safeStart * rowHeight,
    bottomSpacerHeight: Math.max(0, (count - safeEnd) * rowHeight),
    refresh,
  };
}
