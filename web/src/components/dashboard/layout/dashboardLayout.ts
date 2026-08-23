import {
  DASHBOARD_MAX_WIDGETS,
  createWidgetInstance,
  type DashboardBreakpoint,
  type DashboardLayoutItem,
  type DashboardSettings,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
} from "@/lib/dashboard-settings";
import { getAllowedWidths, getWidgetDefinition, sizeColumns } from "../widgetRegistry";

const BREAKPOINT_COLUMNS: Record<DashboardBreakpoint, number> = { desktop: 12, tablet: 6, mobile: 1 };

export function closestAllowedWidth(width: number, allowed: number[]) {
  return allowed.reduce((best, candidate) => Math.abs(candidate - width) < Math.abs(best - width) ? candidate : best, allowed[0]);
}

function collides(left: DashboardLayoutItem, right: DashboardLayoutItem) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

/** Finds the first top-to-bottom, left-to-right grid position that fits. */
export function findFirstDashboardSlot(layout: DashboardLayoutItem[], width: number, height: number, columns: number) {
  const w = Math.max(1, Math.min(columns, Math.round(width)));
  const h = Math.max(1, Math.round(height));
  const maxY = layout.reduce((value, item) => Math.max(value, item.y + item.h), 0);
  const rowStarts = [...new Set([
    0,
    ...layout.map((item) => Math.max(0, item.y)),
    ...layout.map((item) => Math.max(0, item.y + item.h)),
    maxY,
  ])].sort((left, right) => left - right);
  for (const y of rowStarts) {
    for (let x = 0; x <= columns - w; x += 1) {
      const candidate: DashboardLayoutItem = { i: "__candidate__", x, y, w, h };
      if (!layout.some((item) => collides(candidate, item))) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

/** Deterministic first-fit packing used by defaults and acceptance fixtures. */
export function packDashboardLayout(items: DashboardLayoutItem[], columns: number): DashboardLayoutItem[] {
  const packed: DashboardLayoutItem[] = [];
  for (const item of items) {
    const width = Math.max(1, Math.min(columns, Math.round(item.w)));
    const height = Math.max(1, Math.round(item.h));
    const position = findFirstDashboardSlot(packed, width, height, columns);
    packed.push({ ...item, ...position, w: width, h: height });
  }
  return packed;
}

export function snapDashboardItem(item: DashboardLayoutItem, instance: DashboardWidgetInstance, breakpoint: DashboardBreakpoint): DashboardLayoutItem {
  const definition = getWidgetDefinition(instance.type);
  const columns = BREAKPOINT_COLUMNS[breakpoint];
  const allowed = breakpoint === "desktop" ? getAllowedWidths(definition) : breakpoint === "tablet" ? [3, 6] : [1];
  const width = Math.min(columns, closestAllowedWidth(item.w, allowed));
  return {
    ...item,
    w: width,
    x: Math.min(Math.max(0, item.x), columns - width),
    y: Math.max(0, item.y),
    h: Math.max(definition.minHeight, item.h),
  };
}

function defaultWidth(instance: DashboardWidgetInstance, breakpoint: DashboardBreakpoint) {
  if (breakpoint === "mobile") return 1;
  const definition = getWidgetDefinition(instance.type);
  if (breakpoint === "tablet") return definition.minSize === "m" || definition.minSize === "l" || definition.defaultSize === "l" ? 6 : 3;
  return sizeColumns[definition.defaultSize];
}

export function buildDefaultLayout(instances: DashboardWidgetInstance[], breakpoint: DashboardBreakpoint): DashboardLayoutItem[] {
  const columns = BREAKPOINT_COLUMNS[breakpoint];
  const items = instances.map((instance) => {
    const definition = getWidgetDefinition(instance.type);
    const width = defaultWidth(instance, breakpoint);
    return { i: instance.id, x: 0, y: 0, w: width, h: definition.defaultHeight };
  });
  return packDashboardLayout(items, columns);
}

export function resetDashboardLayouts(settings: DashboardSettings): DashboardSettings {
  return {
    ...settings,
    layouts: {
      desktop: buildDefaultLayout(settings.instances, "desktop"),
      tablet: buildDefaultLayout(settings.instances, "tablet"),
      mobile: buildDefaultLayout(settings.instances, "mobile"),
    },
  };
}

export function addDashboardWidget(settings: DashboardSettings, type: DashboardWidgetType): DashboardSettings | null {
  if (settings.instances.length >= DASHBOARD_MAX_WIDGETS) return null;
  const definition = getWidgetDefinition(type);
  if (!definition.allowMultiple && settings.instances.some((instance) => instance.type === type)) return settings;
  const instance = createWidgetInstance(type, settings.instances);
  if (!instance) return null;
  const instances = [...settings.instances, instance];
  const appendAtFirstSlot = (layout: DashboardLayoutItem[], breakpoint: DashboardBreakpoint) => {
    const definition = getWidgetDefinition(instance.type);
    const width = defaultWidth(instance, breakpoint);
    const columns = BREAKPOINT_COLUMNS[breakpoint];
    const position = findFirstDashboardSlot(layout, width, definition.defaultHeight, columns);
    return [...layout, { i: instance.id, ...position, w: width, h: definition.defaultHeight }];
  };
  return {
    ...settings,
    instances,
    layouts: {
      desktop: appendAtFirstSlot(settings.layouts.desktop, "desktop"),
      tablet: appendAtFirstSlot(settings.layouts.tablet, "tablet"),
      mobile: appendAtFirstSlot(settings.layouts.mobile, "mobile"),
    },
  };
}

export function removeDashboardWidget(settings: DashboardSettings, instanceId: string): DashboardSettings {
  return {
    ...settings,
    instances: settings.instances.filter((instance) => instance.id !== instanceId),
    layouts: {
      desktop: settings.layouts.desktop.filter((item) => item.i !== instanceId),
      tablet: settings.layouts.tablet.filter((item) => item.i !== instanceId),
      mobile: settings.layouts.mobile.filter((item) => item.i !== instanceId),
    },
  };
}
