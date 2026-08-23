"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Responsive, type Layout, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DashboardBreakpoint, DashboardSettings, DashboardWidgetInstance } from "@/lib/dashboard-settings";
import { getWidgetDefinition, sizeColumns } from "./widgetRegistry";
import { snapDashboardItem } from "./layout/dashboardLayout";
import { DashboardWidgetFrame } from "./DashboardWidgetFrame";

export type DashboardRenderSize = "xs" | "s" | "m" | "l";

function widgetSize(item: LayoutItem | undefined, breakpoint: DashboardBreakpoint): DashboardRenderSize {
  if (breakpoint === "mobile") return "s";
  const width = item?.w ?? (breakpoint === "tablet" ? 3 : 6);
  const normalized = breakpoint === "tablet" ? width * 2 : width;
  return normalized <= 3 ? "xs" : normalized <= 4 ? "s" : normalized <= 6 ? "m" : "l";
}

function withConstraints(layout: DashboardSettings["layouts"][DashboardBreakpoint], instances: DashboardWidgetInstance[], breakpoint: DashboardBreakpoint): Layout {
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  return layout.flatMap((item) => {
    const instance = byId.get(item.i);
    if (!instance) return [];
    const definition = getWidgetDefinition(instance.type);
    const minW = breakpoint === "mobile" ? 1 : breakpoint === "tablet" ? 3 : sizeColumns[definition.minSize];
    return [{ ...item, minW, maxW: breakpoint === "mobile" ? 1 : breakpoint === "tablet" ? 6 : 12, minH: definition.minHeight }];
  });
}

function persistentLayout(layout: readonly LayoutItem[], instances: DashboardWidgetInstance[], breakpoint: DashboardBreakpoint) {
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  return layout.flatMap((item) => {
    const instance = byId.get(item.i);
    if (!instance) return [];
    return [snapDashboardItem({ i: item.i, x: item.x, y: item.y, w: item.w, h: item.h }, instance, breakpoint)];
  });
}

export function DashboardGrid({ settings, editing, onChange, onInteractionStart, renderWidget, renderWidgetHeader }: {
  settings: DashboardSettings;
  editing: boolean;
  onChange: (settings: DashboardSettings) => void;
  onInteractionStart?: () => void;
  renderWidget: (instance: DashboardWidgetInstance, size: DashboardRenderSize) => ReactNode;
  renderWidgetHeader?: (instance: DashboardWidgetInstance, size: DashboardRenderSize) => ReactNode;
}) {
  const [breakpoint, setBreakpoint] = useState<DashboardBreakpoint>("desktop");
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setContainerWidth((current) => {
      const next = Math.max(0, Math.floor(element.getBoundingClientRect().width));
      return current === next ? current : next;
    });
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layouts = useMemo<ResponsiveLayouts<DashboardBreakpoint>>(() => ({
    desktop: withConstraints(settings.layouts.desktop, settings.instances, "desktop"),
    tablet: withConstraints(settings.layouts.tablet, settings.instances, "tablet"),
    mobile: withConstraints(settings.layouts.mobile, settings.instances, "mobile"),
  }), [settings]);
  const currentLayout = layouts[breakpoint] ?? [];
  const layoutById = new Map(currentLayout.map((item) => [item.i, item]));

  const commitLayouts = (_current: Layout, next: ResponsiveLayouts<DashboardBreakpoint>) => {
    onChange({
      ...settings,
      layouts: {
        desktop: persistentLayout(next.desktop ?? layouts.desktop ?? [], settings.instances, "desktop"),
        tablet: persistentLayout(next.tablet ?? layouts.tablet ?? [], settings.instances, "tablet"),
        mobile: persistentLayout(next.mobile ?? layouts.mobile ?? [], settings.instances, "mobile"),
      },
    });
  };

  if (!settings.instances.length) {
    return <div className="grid min-h-52 place-items-center rounded-3xl border border-dashed border-border/70 px-5 text-center text-sm text-muted-foreground">还没有启用组件，请使用右下角按钮添加。</div>;
  }

  return (
    <div ref={containerRef} className="dashboard-grid min-w-0 overflow-x-clip" data-breakpoint={breakpoint} data-editing={editing || undefined}>
      {containerWidth > 0 ? <Responsive
        width={containerWidth}
        layouts={layouts}
        breakpoints={{ desktop: 1024, tablet: 640, mobile: 0 }}
        cols={{ desktop: 12, tablet: 6, mobile: 1 }}
        rowHeight={56}
        margin={settings.compact ? [12, 12] : [16, 16]}
        containerPadding={[8, 8]}
        compactType="vertical"
        preventCollision={false}
        allowOverlap={false}
        isBounded
        isDraggable={editing}
        isResizable={editing && breakpoint !== "mobile"}
        draggableHandle=".dashboard-widget-drag-handle"
        draggableCancel="button,input,select,textarea,a,[role='button']"
        resizeHandles={["se"]}
        onDragStart={() => onInteractionStart?.()}
        onResizeStart={() => onInteractionStart?.()}
        onBreakpointChange={(next) => setBreakpoint(next as DashboardBreakpoint)}
        onLayoutChange={commitLayouts}
        useCSSTransforms
      >
        {settings.instances.map((instance) => (
          <div key={instance.id} data-widget-id={instance.id} data-widget-type={instance.type}>
            <DashboardWidgetFrame instance={instance} editing={editing} compact={settings.compact} headerRight={renderWidgetHeader?.(instance, widgetSize(layoutById.get(instance.id), breakpoint))}>
              {renderWidget(instance, widgetSize(layoutById.get(instance.id), breakpoint))}
            </DashboardWidgetFrame>
          </div>
        ))}
      </Responsive> : <div className="min-h-52" aria-hidden="true" />}
      <style>{`
        .dashboard-grid .react-grid-placeholder { background: oklch(82% 0.08 235 / .42); border: 1px solid oklch(72% 0.12 235 / .7); border-radius: 24px; opacity: 1; }
        .dashboard-grid .react-grid-item > .react-resizable-handle { opacity: .48; transition: opacity 150ms ease; }
        .dashboard-grid .react-grid-item > .react-resizable-handle:hover { opacity: .82; }
        .dashboard-grid .react-grid-item > .react-resizable-handle::after { border-color: oklch(65% .08 235 / .75); border-width: 0 1.5px 1.5px 0; width: 7px; height: 7px; right: 9px; bottom: 9px; }
        .dashboard-grid:not([data-editing]) .react-resizable-handle { display: none; }
        .dashboard-grid .react-grid-item.react-draggable-dragging { z-index: 50; filter: drop-shadow(0 18px 24px rgb(15 23 42 / .18)); }
      `}</style>
    </div>
  );
}
