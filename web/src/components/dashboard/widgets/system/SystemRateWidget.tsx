"use client";

import { useMemo, useState } from "react";
import { TimeWindowSelector } from "@/components/charts/TimeWindowSelector";
import { withinTimeWindow, type TimeWindowSeconds } from "@/components/charts/timeSeries";
import { formatBytes } from "@/lib/api";
import { RateChart, SYSTEM_CHART_COLORS } from "../../charts";
import { useSystemDashboardData } from "../../data";
import type { SystemWidgetSize } from "./SystemInfoCollectionWidget";

export type SystemRateWidgetProps = { size?: SystemWidgetSize };

function Legend({ color, label, value }: { color: string; label: string; value?: string }) {
  return <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /><span>{label}</span>{value ? <b className="font-semibold tabular-nums text-foreground">{value}</b> : null}</span>;
}

export function SystemRateWidget({ size = "m" }: SystemRateWidgetProps) {
  const { network, history, streamConnected } = useSystemDashboardData();
  const [range, setRange] = useState<TimeWindowSeconds>(60);
  const points = useMemo(() => withinTimeWindow(history, range), [history, range]);
  const download = Number(network.download_speed ?? 0);
  const upload = Number(network.upload_speed ?? 0);
  const connections = Number(network.connections ?? network.connection_count ?? 0);
  const compact = size !== "l";
  const uploadRate = `${formatBytes(upload)}/s`;
  const downloadRate = `${formatBytes(download)}/s`;
  const chartHeight = size === "s" ? "min-h-[150px]" : size === "l" ? "min-h-[270px]" : "min-h-[190px]";
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-rate-layout={compact ? "compact" : "standard"}>
      {!compact ? <div className="mb-2 grid grid-cols-3 gap-2 text-[10px] @min-[520px]:text-xs" data-rate-metrics-placement="header">
        <span className="truncate text-muted-foreground">上传 <b className="tabular-nums text-foreground">{uploadRate}</b></span>
        <span className="truncate text-muted-foreground">下载 <b className="tabular-nums text-foreground">{downloadRate}</b></span>
        <span className="truncate text-right text-muted-foreground">连接 <b className="tabular-nums text-foreground">{connections}</b></span>
      </div> : null}
      <div className={`min-w-0 flex-1 ${chartHeight}`} data-rate-chart><RateChart points={points} downloadSpeed={download} uploadSpeed={upload} connections={connections} windowSeconds={range} /></div>
      <div className={`${compact ? "mt-1 flex flex-col items-stretch gap-1.5" : "mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5"}`} data-rate-footer>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1" data-rate-metrics-placement={compact ? "footer" : undefined}>
          <Legend color={SYSTEM_CHART_COLORS.upload} label="上传" value={compact ? uploadRate : undefined} />
          <Legend color={SYSTEM_CHART_COLORS.download} label="下载" value={compact ? downloadRate : undefined} />
          <Legend color={SYSTEM_CHART_COLORS.connections} label="连接数" value={compact ? String(connections) : undefined} />
          <span className="text-[10px] text-muted-foreground">{streamConnected ? "实时" : "历史补齐"}</span>
        </div>
        <div className="flex min-w-0 justify-end"><TimeWindowSelector value={range} onChange={setRange} /></div>
      </div>
    </div>
  );
}
