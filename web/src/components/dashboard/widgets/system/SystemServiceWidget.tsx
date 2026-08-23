"use client";

import { useMemo, useState } from "react";
import { Play, RotateCw, Server, Square, Zap, type LucideIcon } from "lucide-react";
import { formatBytes, formatPercent } from "@/lib/api";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { useSystemDashboardData, type ServiceAction } from "../../data";

export type SystemServiceWidgetProps = {
  serviceKey: "mosdns" | "mihomo";
  label: string;
  icon?: LucideIcon;
  onMessage?: (message: string) => void;
};

function uptime(seconds: number, label?: string) {
  if (label) return label;
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <SolidPlate tone="regular" className="flex items-center justify-between gap-3 px-3 py-2"><span className="text-xs text-muted-foreground">{label}</span><b className="text-xs font-medium tabular-nums">{value}</b></SolidPlate>;
}

export function SystemServiceWidget({ serviceKey, label, icon: Icon = Server, onMessage }: SystemServiceWidgetProps) {
  const { services, runServiceAction } = useSystemDashboardData();
  const [pending, setPending] = useState<ServiceAction | null>(null);
  const [feedback, setFeedback] = useState("");
  const service = useMemo(() => services.find((item) => item.key === serviceKey || item.key.includes(serviceKey)), [serviceKey, services]);
  const configured = service?.configured ?? false;
  const running = service?.running ?? false;

  const run = async (action: ServiceAction) => {
    setPending(action);
    const progress = `${label}${action === "start" ? "正在启动" : action === "stop" ? "正在停止" : "正在重启"}…`;
    setFeedback(progress);
    onMessage?.(progress);
    try {
      await runServiceAction(serviceKey, action);
      setFeedback(`${label} 操作完成`);
      onMessage?.(`${label} 操作完成`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onMessage?.(message);
    } finally {
      setPending(null);
    }
  };

  if (!service || !configured) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-center">
        <SolidPlate tone="subtle" className="flex h-12 w-12 items-center justify-center rounded-full"><Icon className="h-6 w-6 text-muted-foreground" /></SolidPlate>
        <div><p className="text-sm font-medium">{label} 未配置</p><p className="mt-1 text-xs text-muted-foreground">系统尚未提供该服务，暂不支持控制</p></div>
      </div>
    );
  }

  return (
    <div className="@container flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">状态</span><span className={`gary-status-pill text-xs ${running ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}><i className={`h-1.5 w-1.5 rounded-full ${running ? "bg-green-500" : "bg-muted-foreground"}`} />{running ? "运行中" : "已停止"}</span></div>
      <div className="grid gap-2 @min-[480px]:grid-cols-2">
        <Metric label="CPU" value={formatPercent(service.cpuPercent)} />
        <Metric label="内存" value={service.memoryLabel ?? formatBytes(service.memoryBytes)} />
        <Metric label="运行时间" value={uptime(service.uptimeSeconds, service.uptimeLabel)} />
        {service.pid ? <Metric label="PID" value={String(service.pid)} /> : null}
      </div>
      <div className="mt-auto flex gap-2 pt-1">
        {running ? <button type="button" disabled={pending !== null} onClick={() => void run("stop")} className="gary-glass-button flex-1 gap-1.5 rounded-xl px-3 py-2 text-xs text-destructive disabled:opacity-50"><Square className="h-3.5 w-3.5" />停止</button> : <button type="button" disabled={pending !== null} onClick={() => void run("start")} className="gary-glass-button flex-1 gap-1.5 rounded-xl px-3 py-2 text-xs text-green-600 disabled:opacity-50"><Play className="h-3.5 w-3.5" />启动</button>}
        <button type="button" disabled={pending !== null} onClick={() => void run("restart")} className="gary-glass-button flex-1 gap-1.5 rounded-xl px-3 py-2 text-xs text-primary disabled:opacity-50"><RotateCw className={`h-3.5 w-3.5 ${pending === "restart" ? "animate-spin" : ""}`} />重启</button>
      </div>
      {feedback ? <p aria-live="polite" className="truncate text-[10px] text-muted-foreground">{feedback}</p> : null}
    </div>
  );
}

export type ServiceWidgetProps = Omit<SystemServiceWidgetProps, "serviceKey" | "label" | "icon">;
export function MosdnsServiceWidget(props: ServiceWidgetProps) { return <SystemServiceWidget {...props} serviceKey="mosdns" label="MosDNS" icon={Server} />; }
export function MihomoServiceWidget(props: ServiceWidgetProps) { return <SystemServiceWidget {...props} serviceKey="mihomo" label="Mihomo" icon={Zap} />; }
