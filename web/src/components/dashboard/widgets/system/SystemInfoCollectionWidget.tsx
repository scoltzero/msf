"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatPercent } from "@/lib/api";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { DashboardCollectionTabs } from "../../DashboardCollectionTabs";
import { useSystemDashboardData } from "../../data";

export type SystemInfoPage = "device" | "hardware" | "stats";
export type SystemWidgetSize = "s" | "m" | "l";

export const SYSTEM_INFO_OPTIONS = [
  { id: "device", label: "设备", pickerLabel: "设备信息" },
  { id: "hardware", label: "硬件", pickerLabel: "硬件信息" },
  { id: "stats", label: "统计", pickerLabel: "统计信息" },
] as const;

export type SystemInfoCollectionWidgetProps = {
  activePage?: SystemInfoPage;
  onActivePageChange?: (page: SystemInfoPage) => void;
  pages?: SystemInfoPage[];
  onPagesChange?: (pages: SystemInfoPage[]) => void;
  showNavigation?: boolean;
  size?: SystemWidgetSize;
};

function formatUptime(value: unknown) {
  if (typeof value === "string" && value) return value;
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function InfoRows({ rows, allowColumns }: { rows: Array<{ label: string; value: string }>; allowColumns: boolean }) {
  return <div className={`grid gap-2 ${allowColumns ? "@min-[620px]:grid-cols-2" : ""}`}>{rows.map((row) => <SolidPlate key={row.label} tone="regular" className="flex min-h-10 items-center justify-between gap-3 px-3 py-2.5"><span className="shrink-0 text-sm text-muted-foreground">{row.label}</span><span className="min-w-0 break-words text-right text-sm font-medium tabular-nums">{row.value}</span></SolidPlate>)}</div>;
}

export function SystemInfoCollectionWidget({ activePage, onActivePageChange, pages = ["device", "hardware", "stats"], onPagesChange, showNavigation = true, size = "m" }: SystemInfoCollectionWidgetProps) {
  const { system, resources, network } = useSystemDashboardData();
  const [internalPage, setInternalPage] = useState<SystemInfoPage>(pages[0] ?? "device");
  const selectedPages: SystemInfoPage[] = pages.length ? pages : ["device"];
  const requested = activePage ?? internalPage;
  const page = selectedPages.includes(requested) ? requested : selectedPages[0];
  const setPage = (next: SystemInfoPage) => { if (activePage === undefined) setInternalPage(next); onActivePageChange?.(next); };
  const rows = useMemo<Record<SystemInfoPage, Array<{ label: string; value: string }>>>(() => ({
    device: [
      { label: "主机名", value: display(system.hostname) },
      { label: "系统平台", value: display(system.platform ?? `${system.os || "-"}/${system.arch || "-"}`) },
      { label: "运行时间", value: formatUptime(system.uptime_seconds ?? system.uptime) },
      { label: "数据目录", value: display(system.data_dir) },
    ],
    hardware: [
      { label: "CPU", value: display(resources.cpu_model ?? resources.hardware?.cpu_model) },
      { label: "核心数", value: display(resources.cores ?? resources.cpu_cores) },
      { label: "内存", value: formatBytes(resources.memory_total ?? resources.mem_total) },
      { label: "硬盘容量", value: formatBytes(resources.disk_total) },
    ],
    stats: [
      { label: "CPU 使用率", value: formatPercent(resources.cpu_percent ?? resources.cpu) },
      { label: "内存使用率", value: formatPercent(resources.memory_percent ?? resources.mem_percent) },
      { label: "总上传流量", value: formatBytes(network.total_upload ?? network.upload_total) },
      { label: "总下载流量", value: formatBytes(network.total_download ?? network.download_total) },
    ],
  }), [network, resources, system]);

  return <div className="@container flex h-full min-h-0 flex-col gap-3">
    {showNavigation && (selectedPages.length > 1 || onPagesChange) ? <DashboardCollectionTabs options={SYSTEM_INFO_OPTIONS} selected={selectedPages} active={page} onSelectedChange={onPagesChange} onActiveChange={setPage} ariaLabel="系统信息页面" /> : null}
    <div className="min-h-0 flex-1" role="tabpanel"><InfoRows rows={rows[page]} allowColumns={selectedPages.length > 1} />{page === "hardware" ? <SolidPlate tone="regular" className="mt-2 px-3 py-2.5"><div className="mb-1.5 flex items-center justify-between"><span className="text-sm text-muted-foreground">硬盘使用率</span><span className="text-sm font-medium tabular-nums">{formatPercent(resources.disk_percent)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted/50"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70" style={{ width: `${Math.min(Number(resources.disk_percent || 0), 100)}%` }} /></div></SolidPlate> : null}</div>
    {size === "s" && selectedPages.length > 1 ? <p className="text-[10px] text-muted-foreground">已合并 {selectedPages.length} 个信息页</p> : null}
  </div>;
}
