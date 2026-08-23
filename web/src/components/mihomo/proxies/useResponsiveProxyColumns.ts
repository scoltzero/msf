import { useEffect, useRef, useState, type RefObject } from "react";

/** Minimum proxy content width at which two independent columns remain useful. */
export const PROXY_TWO_COLUMN_MIN_WIDTH = 600;
/** At or below this content width, node details belong in the modal layer. */
export const PROXY_NODE_DIALOG_MAX_WIDTH = 768;

export function shouldUseProxyColumns(width: number, doubleColumn = true): boolean {
  return doubleColumn && width >= PROXY_TWO_COLUMN_MIN_WIDTH;
}
export function shouldUseProxyNodeDialog(width: number): boolean {
  return width > 0 && width <= PROXY_NODE_DIALOG_MAX_WIDTH;
}

/**
 * Keep configuration order deterministic while rendering a true two-column
 * waterfall. CSS grid/columns cannot guarantee that expanding one card leaves
 * the other column anchored, so each parity gets its own flex column.
 */
export function splitProxyItems<T>(items: readonly T[], split: boolean): [T[], T[]] {
  if (!split) return [Array.from(items), []];
  return [items.filter((_, index) => index % 2 === 0), items.filter((_, index) => index % 2 === 1)];
}

export type ResponsiveProxyColumns = {
  containerRef: RefObject<HTMLDivElement | null>;
  width: number;
  isSplit: boolean;
  isNodeDialogMode: boolean;
};

/** Measure the proxy content container rather than relying on viewport breakpoints. */
export function useResponsiveProxyColumns(doubleColumn = true): ResponsiveProxyColumns {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const update = () => {
      const next = element.getBoundingClientRect().width;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    };
    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const next = entry?.contentRect.width ?? element.getBoundingClientRect().width;
        setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
      });
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return {
    containerRef,
    width,
    isSplit: shouldUseProxyColumns(width, doubleColumn),
    isNodeDialogMode: shouldUseProxyNodeDialog(width),
  };
}
