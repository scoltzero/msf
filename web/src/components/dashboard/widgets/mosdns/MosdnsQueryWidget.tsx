"use client";

import { useMemo, useRef, useState } from "react";
import { EChartCanvas, type EChartsOption } from "@/components/charts/EChartCanvas";
import { TimeWindowSelector } from "@/components/charts/TimeWindowSelector";
import type { TimeWindowSeconds } from "@/components/charts/timeSeries";
import { useMosdnsDashboardData } from "../../data";
import { buildMosdnsTrend, finiteNumber, freezeMosdnsTrend, type MosdnsTrendBucket, type MosdnsWidgetSize } from "./model";

export function MosdnsQueryWidget({ size = "m" }: { size?: MosdnsWidgetSize }) {
  const { overview, queryEntries } = useMosdnsDashboardData(["overview", "query"]);
  const [range, setRange] = useState<TimeWindowSeconds>(60);
  const frozenRef = useRef<{ range: number; buckets?: MosdnsTrendBucket[] }>({ range });
  const buckets = useMemo(() => {
    if (frozenRef.current.range !== range) frozenRef.current = { range };
    const next = freezeMosdnsTrend(frozenRef.current.buckets, buildMosdnsTrend(queryEntries, range));
    frozenRef.current.buckets = next;
    return next;
  }, [queryEntries, range]);
  const audit = overview.audit_stats || overview.audit || {};
  const total = finiteNumber(overview.query_count ?? audit.total_queries ?? queryEntries.length);
  const average = finiteNumber(audit.average_duration_ms ?? overview.stats?.average_duration_ms);
  const latest = queryEntries[0] || {};
  const current = finiteNumber(latest.duration_ms ?? latest.elapsed_ms ?? latest.cost_ms ?? latest.ms ?? average);
  const option = useMemo<EChartsOption>(() => ({ animationDurationUpdate: 500, grid: { left: 2, top: 4, right: 2, bottom: 4 }, tooltip: { trigger: "axis", confine: true }, xAxis: { type: "time", show: false }, yAxis: [{ type: "value", show: false }, { type: "value", show: false }], series: [{ name: "新增查询", type: "line", showSymbol: false, smooth: .2, lineStyle: { color: "oklch(60% .21 235)", width: 2.5 }, areaStyle: { color: "oklch(60% .21 235 / .12)" }, data: buckets.map((row) => [row.timestamp, row.queries]) }, { name: "当前耗时", type: "line", yAxisIndex: 1, showSymbol: false, smooth: .2, lineStyle: { color: "oklch(60% .17 152)", width: 2.5 }, data: buckets.map((row) => [row.timestamp, row.durationMs]) }] }), [buckets]);
  return <div className="flex h-full min-h-0 flex-col"><div className="mb-2 grid grid-cols-4 gap-2 text-[10px] text-muted-foreground @container"><span>新增 <b className="block text-sm text-foreground">{queryEntries.length}</b></span><span>当前耗时 <b className="block text-sm text-foreground">{current.toFixed(2)}ms</b></span><span>总查询 <b className="block text-sm text-foreground">{total.toLocaleString()}</b></span><span>平均 <b className="block text-sm text-foreground">{average.toFixed(2)}ms</b></span></div><div className={size === "s" ? "min-h-[130px] flex-1" : "min-h-[180px] flex-1"}><EChartCanvas option={option} /></div><div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5"><div className="flex gap-3 text-[10px] text-muted-foreground"><span>● 新增查询</span><span className="text-emerald-600">● 当前耗时</span></div><TimeWindowSelector value={range} onChange={setRange} /></div></div>;
}
