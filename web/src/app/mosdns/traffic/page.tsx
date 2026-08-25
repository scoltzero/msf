"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, MonitorDot, Network, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { api, apiData, formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";

type TrafficDevice = {
  ip: string;
  name: string;
  mac: string;
  rxRate: number;
  txRate: number;
  rxBytes: number;
  txBytes: number;
  connections: number;
  active: boolean;
};

function numberValue(value: unknown) {
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : 0;
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function deviceRows(payload: unknown): TrafficDevice[] {
  const data = objectValue(payload);
  const rows = Array.isArray(data.devices) ? data.devices : Array.isArray(data.clients) ? data.clients : [];
  return rows
    .map((row): TrafficDevice => {
      const item = objectValue(row);
      return {
        ip: stringValue(item.ip || item.address),
        name: stringValue(item.hostname || item.name || item.host),
        mac: stringValue(item.mac || item.mac_address),
        rxRate: numberValue(item.rx_rate ?? item.download_rate ?? item.rx_bps),
        txRate: numberValue(item.tx_rate ?? item.upload_rate ?? item.tx_bps),
        rxBytes: numberValue(item.rx_bytes ?? item.download_bytes ?? item.rx_total),
        txBytes: numberValue(item.tx_bytes ?? item.upload_bytes ?? item.tx_total),
        connections: numberValue(item.connections ?? item.connection_count),
        active: item.active !== false && item.online !== false,
      };
    })
    .filter((item) => item.ip)
    .sort((left, right) => right.rxRate + right.txRate - (left.rxRate + left.txRate) || left.ip.localeCompare(right.ip));
}

function summaryValue(payload: unknown, keys: string[]) {
  const data = objectValue(payload);
  const summary = objectValue(data.summary || data.stats || data);
  for (const key of keys) {
    if (summary[key] != null) return numberValue(summary[key]);
  }
  return 0;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof ArrowDownToLine; label: string; value: string; tone: string }) {
  return (
    <GlassSurface material="ultrathin" className="min-w-0 p-3" style={{ "--gary-local-radius": "12px" } as CSSProperties}>
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]", tone)}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-semibold text-foreground">{value}</div>
        </div>
      </div>
    </GlassSurface>
  );
}

export default function MosdnsTrafficPage() {
  const [snapshot, setSnapshot] = useState<any>({});
  const [selected, setSelected] = useState<TrafficDevice | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const payload = await api<any>("/api/v1/mosdns/traffic/snapshot");
      setSnapshot(apiData(payload, {}));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "流量代理不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const devices = useMemo(() => deviceRows(snapshot), [snapshot]);
  const downloadRate = summaryValue(snapshot, ["rx_rate", "download_rate", "rx_bps"]);
  const uploadRate = summaryValue(snapshot, ["tx_rate", "upload_rate", "tx_bps"]);
  const connections = summaryValue(snapshot, ["connections", "connection_count", "active_connections"]);

  const selectDevice = async (device: TrafficDevice) => {
    setSelected(device);
    setDetail(null);
    try {
      const payload = await api<any>(`/api/v1/mosdns/traffic/client?ip=${encodeURIComponent(device.ip)}`);
      setDetail(apiData(payload, {}));
    } catch {
      setDetail({});
    }
  };

  return (
    <AppShell>
      <div className="space-y-3 animate-fade-in">
        <WorkbenchHeader
          icon={Activity}
          title="流量监控"
          description="局域网设备实时流量与连接状态"
          status={<span className={cn("flex items-center gap-1.5 text-xs", error ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground")}><span className={cn("h-2 w-2 rounded-full", error ? "bg-amber-500" : "bg-emerald-500")} />{error || (loading ? "正在连接" : "每秒更新")}</span>}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={ArrowDownToLine} label="当前下载" value={`${formatBytes(downloadRate)}/s`} tone="bg-sky-500/10 text-sky-600 dark:text-sky-300" />
          <Metric icon={ArrowUpFromLine} label="当前上传" value={`${formatBytes(uploadRate)}/s`} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" />
          <Metric icon={Users} label="活跃设备" value={`${devices.filter((device) => device.active).length} 台`} tone="bg-violet-500/10 text-violet-600 dark:text-violet-300" />
          <Metric icon={Network} label="当前连接" value={connections.toLocaleString()} tone="bg-amber-500/10 text-amber-600 dark:text-amber-300" />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <GlassSurface material="thick" className="overflow-hidden" style={{ "--gary-local-radius": "16px" } as CSSProperties}>
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
              <div className="flex items-center gap-2"><MonitorDot className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">设备列表</h2></div>
              <span className="text-xs text-muted-foreground">{devices.length} 台设备</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-4 py-2.5 font-medium">设备</th><th className="px-3 py-2.5 font-medium">IP</th><th className="px-3 py-2.5 text-right font-medium">下载</th><th className="px-3 py-2.5 text-right font-medium">上传</th><th className="px-3 py-2.5 text-right font-medium">连接</th><th className="px-4 py-2.5 text-right font-medium">累计流量</th></tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.ip} onClick={() => void selectDevice(device)} className={cn("cursor-pointer border-b border-border/35 transition-colors hover:bg-muted/40", selected?.ip === device.ip && "bg-primary/8")}>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", device.active ? "bg-emerald-500" : "bg-muted-foreground/50")} /><span className="font-medium">{device.name || "未知设备"}</span></div><div className="mt-0.5 pl-4 text-xs text-muted-foreground">{device.mac || "-"}</div></td>
                      <td className="px-3 py-3 font-mono text-xs">{device.ip}</td><td className="px-3 py-3 text-right text-sky-700 dark:text-sky-300">{formatBytes(device.rxRate)}/s</td><td className="px-3 py-3 text-right text-emerald-700 dark:text-emerald-300">{formatBytes(device.txRate)}/s</td><td className="px-3 py-3 text-right">{device.connections}</td><td className="px-4 py-3 text-right text-xs text-muted-foreground">下 {formatBytes(device.rxBytes)} / 上 {formatBytes(device.txBytes)}</td>
                    </tr>
                  ))}
                  {devices.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">{error || "暂无可显示的设备流量"}</td></tr>}
                </tbody>
              </table>
            </div>
          </GlassSurface>

          <GlassSurface material="thick" className="min-h-48 p-4" style={{ "--gary-local-radius": "16px" } as CSSProperties}>
            <h2 className="text-sm font-semibold">设备详情</h2>
            {selected ? <div className="mt-4 space-y-3 text-sm"><div><div className="text-xs text-muted-foreground">IP 地址</div><div className="mt-1 font-mono">{selected.ip}</div></div><div><div className="text-xs text-muted-foreground">设备名称</div><div className="mt-1">{selected.name || "未知设备"}</div></div><div><div className="text-xs text-muted-foreground">实时连接</div><div className="mt-1">{numberValue(objectValue(detail).connections ?? selected.connections).toLocaleString()}</div></div><div className="border-t border-border/40 pt-3 text-xs text-muted-foreground">下行 {formatBytes(selected.rxBytes)}，上行 {formatBytes(selected.txBytes)}</div></div> : <div className="flex min-h-40 items-center text-sm text-muted-foreground">选择一台设备查看详情</div>}
          </GlassSurface>
        </div>
      </div>
    </AppShell>
  );
}
