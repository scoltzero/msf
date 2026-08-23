"use client";

import { useMemo, useState } from "react";
import { Cpu, MemoryStick } from "lucide-react";
import { TimeWindowSelector } from "@/components/charts/TimeWindowSelector";
import { withinTimeWindow, type TimeWindowSeconds } from "@/components/charts/timeSeries";
import { formatPercent } from "@/lib/api";
import { TrendChart, SYSTEM_CHART_COLORS } from "../../charts";
import { useSystemDashboardData } from "../../data";
import type { SystemWidgetSize } from "./SystemInfoCollectionWidget";

export type SystemResourcesWidgetProps = { size?: SystemWidgetSize };

export function systemPercentScale(points: Array<{ cpuPercent?: unknown; memoryPercent?: unknown }>, cpu: unknown, memory: unknown) {
  const numbers = (points.length ? points.flatMap((point) => [point.cpuPercent, point.memoryPercent]) : [cpu, memory])
    .map(Number)
    .filter(Number.isFinite);
  return Math.max(10, Math.min(100, Math.ceil(Math.max(...numbers, 1) / 10) * 10));
}

export function SystemResourcesWidget({ size = "m" }: SystemResourcesWidgetProps) {
  const { resources, history } = useSystemDashboardData();
  const [range, setRange] = useState<TimeWindowSeconds>(180);
  const [autoScale, setAutoScale] = useState(false);
  const cpu = resources.cpu_percent ?? resources.cpu ?? 0;
  const memory = resources.memory_percent ?? resources.mem_percent ?? 0;
  const points = useMemo(() => withinTimeWindow(history, range), [history, range]);
  const scaleMax = autoScale ? systemPercentScale(points, cpu, memory) : 100;
  const chartHeight = size === "s" ? "min-h-[130px]" : size === "l" ? "min-h-[260px]" : "min-h-[165px]";

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" style={{ color: SYSTEM_CHART_COLORS.cpu }} />CPU <b className="tabular-nums text-foreground">{formatPercent(cpu)}</b></span>
          <span className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" style={{ color: SYSTEM_CHART_COLORS.memory }} />内存 <b className="tabular-nums text-foreground">{formatPercent(memory)}</b></span>
        </div>
        <button type="button" aria-pressed={autoScale} onClick={() => setAutoScale((value) => !value)} className={`gary-segmented__item px-2.5 py-1.5 text-[10px] ${autoScale ? "gary-segmented__item--active" : "text-muted-foreground"}`} title="切换固定 100% / 动态量程">{autoScale ? `动态 ${scaleMax}%` : "固定 100%"}</button>
      </div>
      <div className={`flex flex-1 gap-2 overflow-hidden ${chartHeight}`}>
        <div className="flex flex-col justify-between py-1 text-[10px] tabular-nums text-muted-foreground"><span>{scaleMax}%</span><span>{Math.round(scaleMax / 2)}%</span><span>0%</span></div>
        <div className="min-w-0 flex-1"><TrendChart points={points} cpuPercent={cpu} memoryPercent={memory} scaleMax={scaleMax} windowSeconds={range} /></div>
      </div>
      <div className="mt-2 flex min-w-0 justify-end"><TimeWindowSelector value={range} onChange={setRange} /></div>
    </div>
  );
}
