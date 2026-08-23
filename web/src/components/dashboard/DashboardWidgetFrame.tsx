import type { ReactNode } from "react";
import type { DashboardWidgetInstance } from "@/lib/dashboard-settings";
import { DashboardCard } from "./DashboardCard";
import { DashboardWidgetErrorBoundary } from "./DashboardWidgetErrorBoundary";
import { getWidgetDefinition } from "./widgetRegistry";

export function DashboardWidgetFrame({ instance, editing, compact, headerRight, children }: { instance: DashboardWidgetInstance; editing: boolean; compact: boolean; headerRight?: ReactNode; children: ReactNode }) {
  const definition = getWidgetDefinition(instance.type);
  return (
    <DashboardCard title={definition.label} icon={definition.icon} editing={editing} compact={compact} headerRight={headerRight} className={editing ? "ring-1 ring-sky-400/35" : undefined}>
      <DashboardWidgetErrorBoundary title={definition.label}>{children}</DashboardWidgetErrorBoundary>
    </DashboardCard>
  );
}
