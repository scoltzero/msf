import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface VirtualLogRange {
  start: number;
  end: number;
}

export function calculateVirtualLogRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): VirtualLogRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, firstVisible + visibleCount + overscan);
  return { start, end: Math.max(start, end) };
}

export function useVirtualLogRows({
  count,
  rowHeight,
  overscan = 10,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<VirtualLogRange>(() =>
    calculateVirtualLogRange(count, 0, 400, rowHeight, overscan),
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = calculateVirtualLogRange(
      count,
      container.scrollTop,
      container.clientHeight,
      rowHeight,
      overscan,
    );
    setRange((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, [count, overscan, rowHeight]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  const virtualRows = useMemo(
    () => Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset),
    [range.end, range.start],
  );

  return {
    containerRef,
    measure,
    virtualRows,
    totalHeight: count * rowHeight,
  };
}
