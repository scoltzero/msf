"use client";
import { lazy, Suspense, type ComponentProps } from "react";
import type { EChartCanvas } from "@/components/charts/EChartCanvas";
import { useDeferredWork } from "@/lib/page-readiness";
const Chart = lazy(() => import("@/components/charts/EChartCanvas").then(m => ({ default: m.EChartCanvas })));
export function ZashboardEChart(props: ComponentProps<typeof EChartCanvas>) {
  const ready = useDeferredWork(true, 300);
  return ready ? <Suspense fallback={null}><Chart {...props} /></Suspense> : null;
}
export type { EChartsOption } from "echarts";
