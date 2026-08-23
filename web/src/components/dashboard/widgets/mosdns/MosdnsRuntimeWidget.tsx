"use client";

import { useState, type ComponentType } from "react";
import { Activity, Cpu, MemoryStick, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { useMosdnsDashboardData } from "../../data";
import { normalizeMosdnsRuntime, type MosdnsRuntimePage, type MosdnsWidgetSize } from "./model";

const options = [{ id: "overview", label: "概览" }, { id: "memory", label: "内存" }, { id: "system", label: "系统" }] as const;
type RuntimeRow = { label: string; value: string; sub: string };
type RuntimeMetricStyle = { Icon: ComponentType<{ className?: string }>; text: string; tile: string };

export function runtimeMetricStyle(label: string): RuntimeMetricStyle {
  if (label.includes("CPU")) return { Icon: Cpu, text: "text-orange-600 dark:text-orange-400", tile: "bg-orange-500/10" };
  if (label.includes("RSS")) return { Icon: MemoryStick, text: "text-blue-600 dark:text-blue-400", tile: "bg-blue-500/10" };
  if (label.includes("堆内存使用")) return { Icon: MemoryStick, text: "text-purple-600 dark:text-purple-400", tile: "bg-purple-500/10" };
  if (label.includes("堆内存空闲")) return { Icon: MemoryStick, text: "text-blue-600 dark:text-blue-400", tile: "bg-blue-500/10" };
  if (label.includes("GC 次数")) return { Icon: Timer, text: "text-amber-600 dark:text-amber-400", tile: "bg-amber-500/10" };
  if (label.includes("GC 耗时")) return { Icon: Timer, text: "text-pink-600 dark:text-pink-400", tile: "bg-pink-500/10" };
  if (label.includes("缓存命中") || label.includes("文件描述符")) return { Icon: Activity, text: "text-cyan-600 dark:text-cyan-400", tile: "bg-cyan-500/10" };
  return { Icon: Activity, text: "text-emerald-600 dark:text-emerald-400", tile: "bg-emerald-500/10" };
}

function CompactRows({ rows }: { rows: RuntimeRow[] }) {
  return (
    <div className="grid min-h-0 grid-cols-2 gap-x-3 gap-y-1.5">
      {rows.map((row) => <div key={row.label} className="min-w-0 border-b border-foreground/[.07] pb-1.5 last:border-b-0">
        <p className="truncate text-[9px] text-muted-foreground">{row.label}</p>
        <p className="truncate text-sm font-semibold tabular-nums" title={row.value}>{row.value}</p>
      </div>)}
    </div>
  );
}

function MetricTile({ row }: { row: RuntimeRow }) {
  const { Icon, text, tile } = runtimeMetricStyle(row.label);
  return (
    <SolidPlate tone="regular" className="group min-w-0 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
          <p className={cn("mt-0.5 truncate text-base font-bold tabular-nums", text)} title={row.value}>{row.value}</p>
          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{row.sub}</p>
        </div>
        <span className={cn("shrink-0 rounded-lg p-1 transition-transform duration-250 group-hover:scale-105", tile)}>
          <Icon className={cn("h-4 w-4", text)} />
        </span>
      </div>
    </SolidPlate>
  );
}

function MetricSection({ label, rows, columns }: { label?: string; rows: RuntimeRow[]; columns: 3 | 4 }) {
  return (
    <section className="min-w-0">
      {label ? <p className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</p> : null}
      <div className={cn("grid gap-1.5", columns === 4 ? "grid-cols-4" : "grid-cols-3")}>
        {rows.map((row) => <MetricTile key={row.label} row={row} />)}
      </div>
    </section>
  );
}

export function MosdnsRuntimeWidget({ activePage, onActivePageChange, size = "m" }: { activePage?: MosdnsRuntimePage; onActivePageChange?: (page: MosdnsRuntimePage) => void; size?: MosdnsWidgetSize }) {
  const { overview } = useMosdnsDashboardData(["overview"]);
  const [internal, setInternal] = useState<MosdnsRuntimePage>("overview");
  const page = activePage ?? internal;
  const data = normalizeMosdnsRuntime(overview);
  const setPage = (next: MosdnsRuntimePage) => {
    if (activePage === undefined) setInternal(next);
    onActivePageChange?.(next);
  };

  if (size === "xs" || size === "s") {
    return <div className="flex h-full min-h-0 flex-col gap-2">
      <GlassSegmentedControl value={page} onChange={setPage} options={options.map((item) => ({ ...item }))} ariaLabel="运行指标页面" className="grid w-full shrink-0 grid-cols-3" />
      <CompactRows rows={data[page]} />
    </div>;
  }

  return <div className="flex h-full min-h-0 flex-col gap-2.5">
    <MetricSection rows={data.overview} columns={4} />
    <MetricSection label="内存" rows={data.memory} columns={3} />
    <MetricSection label="系统" rows={data.system} columns={4} />
  </div>;
}
