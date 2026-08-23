"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/api";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { aggregateConnections, toClosedConnection, type HistoryAggregation } from "@/components/mihomo/overview/connectionHistory";
import { useMihomoDashboardData } from "../../data";
import type { MihomoWidgetSize } from "./MihomoTrafficWidget";

const labels: Record<HistoryAggregation, string> = { source: "源 IP", target: "目标主机", process: "进程", outbound: "最终出口", proxyGroup: "代理分组" };
export type MihomoConnectionStatsWidgetProps = { size?: MihomoWidgetSize };

export function MihomoConnectionStatsWidget({ size = "l" }: MihomoConnectionStatsWidgetProps) {
  const { connections, closedConnections, clearConnectionHistory, applyConnectionRetention } = useMihomoDashboardData();
  const [aggregation, setAggregation] = useState<HistoryAggregation>(() => typeof window === "undefined" ? "source" : (localStorage.getItem("msf-mihomo-history-aggregation") as HistoryAggregation) || "source");
  const [retention, setRetention] = useState(() => typeof window === "undefined" ? 30 : Number(localStorage.getItem("msf-mihomo-history-cleanup-days") || 30));
  const rows = useMemo(() => aggregateConnections([...closedConnections, ...connections.map((row) => toClosedConnection(row))], aggregation).sort((a, b) => b.download + b.upload - a.download - a.upload), [aggregation, closedConnections, connections]);
  const totals = rows.reduce((sum, row) => ({ download: sum.download + row.download, upload: sum.upload + row.upload, count: sum.count + row.count }), { download: 0, upload: 0, count: 0 });
  const setDays = (days: number) => { setRetention(days); localStorage.setItem("msf-mihomo-history-cleanup-days", String(days)); void applyConnectionRetention(days); };
  const clear = async () => { if (!window.confirm("确认清空全部已关闭连接历史？此操作无法撤销，当前活动连接不会被断开。")) return; await clearConnectionHistory(); };
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-1.5"><select value={aggregation} onChange={(event) => { const value = event.target.value as HistoryAggregation; setAggregation(value); localStorage.setItem("msf-mihomo-history-aggregation", value); }} className="gary-field h-8 rounded-lg px-2 text-xs">{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={retention} onChange={(event) => setDays(Number(event.target.value))} className="gary-field h-8 rounded-lg px-2 text-xs"><option value={0}>永不清理</option><option value={7}>保留一周</option><option value={30}>保留一月</option><option value={90}>保留三月</option></select><button type="button" onClick={() => void clear()} className="gary-glass-button h-8 w-8 rounded-lg text-destructive" title="清空连接历史"><Trash2 className="h-3.5 w-3.5" /></button></div>
    <div className={`grid gap-2 ${size === "m" ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-5"}`}>{[[labels[aggregation], rows.length], ["总流量", formatBytes(totals.download + totals.upload)], ["下载", formatBytes(totals.download)], ["上传", formatBytes(totals.upload)], ["连接次数", totals.count]].map(([label, value], index) => <SolidPlate tone="regular" key={String(label)} className={size === "m" && index === 4 ? "col-span-2 p-2.5" : "p-2.5"}><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-base font-light tabular-nums">{value}</div></SolidPlate>)}</div>
    {rows.length ? <SolidPlate tone="strong" className="min-h-0 flex-1 overflow-y-auto rounded-xl"><table className="w-full table-fixed text-xs"><thead className="sticky top-0 z-10 gary-solid-plate--strong"><tr><th className="w-[36%] px-3 py-2 text-left">{labels[aggregation]}</th><th className="px-2 py-2 text-right">下载</th><th className="px-2 py-2 text-right">上传</th><th className="px-2 py-2 text-right">总量</th><th className="px-2 py-2 text-right">次数</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border/30"><td className="truncate px-3 py-2 font-mono" title={row.key}>{row.key}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.download)}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.upload)}</td><td className="px-2 py-2 text-right tabular-nums">{formatBytes(row.download + row.upload)}</td><td className="px-2 py-2 text-right tabular-nums">{row.count}</td></tr>)}</tbody></table></SolidPlate> : <div className="flex min-h-24 flex-1 items-center justify-center rounded-xl border border-dashed border-border/55 text-xs text-muted-foreground">等待活动连接或已关闭连接历史</div>}
  </div>;
}
