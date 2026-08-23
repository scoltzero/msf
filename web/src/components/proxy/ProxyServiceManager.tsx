"use client";

import { useState } from "react";
import { Network, Play, RefreshCw, Square, TriangleAlert, Zap } from "lucide-react";
import { api, apiData, formatBytes, formatPercent } from "@/lib/api";
import { useApiPath } from "@/lib/use-api";
import { ToastStack, type ToastItem } from "@/components/rules/RuleDialogs";

type Engine = "mihomo" | "singbox";

function InfoBit({ label, value }: { label: string; value: string }) {
  return (
    <div className="whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function normalizeStatus(payload: any) {
  return apiData<any>(payload, {});
}

function displayUptime(value: unknown) {
  if (typeof value === "string" && value) return value;
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function ProxyServiceManager() {
  const [engine, setEngine] = useState<Engine>("mihomo");
  const [busy, setBusy] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const mihomo = useApiPath<any>("/api/v1/mihomo/status", [], 3000);
  const singbox = useApiPath<any>("/api/v1/singbox/status", [], 5000);
  const current = engine === "mihomo" ? normalizeStatus(mihomo.data) : normalizeStatus(singbox.data);
  const running = Boolean(current.running || current.status === "running");
  const installed = current.installed !== false;

  const showToast = (message: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2600);
  };

  const reload = () => {
    void mihomo.reload();
    void singbox.reload();
  };

  const runAction = async (action: "start" | "stop" | "restart") => {
    const service = engine === "mihomo" ? "mihomo" : "singbox";
    setBusy(action);
    showToast(`${engine === "mihomo" ? "Mihomo" : "Sing-Box"} 正在${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}...`);
    try {
      const payload = await api<any>(`/api/v1/services/${service}/${action}?wait=1&timeout=5`, { method: "POST" });
      if (payload.success === false) throw new Error(payload.error || "服务操作失败");
      showToast("操作完成");
      reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-6">
      <ToastStack toasts={toasts} />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-[10px] bg-gradient-to-br from-primary/10 to-secondary/10">
          <Network className="h-5 w-5 md:h-6 md:w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold leading-none text-foreground">代理服务管理</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Sing-Box / Mihomo 二选一管理</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          { key: "mihomo" as Engine, label: "Mihomo", data: normalizeStatus(mihomo.data), icon: Zap },
          { key: "singbox" as Engine, label: "Sing-Box", data: normalizeStatus(singbox.data), icon: TriangleAlert },
        ].map(({ key, label, data, icon: Icon }) => {
          const isRunning = Boolean(data.running || data.status === "running");
          const isInstalled = data.installed !== false;
          return (
            <button
              key={key}
              onClick={() => setEngine(key)}
              className={
                "p-4 rounded-lg border-2 transition-all text-left relative overflow-hidden " +
                (engine === key ? "border-primary bg-primary/5 shadow-md" : "border-border/50 hover:border-primary/50 hover:bg-accent/30")
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-bold">{label}</h3>
                  <div className={(isRunning ? "bg-primary animate-pulse" : "bg-gray-400") + " h-2 w-2 rounded-full"} />
                </div>
                <div className={(isRunning ? "bg-green-600 dark:bg-green-500" : isInstalled ? "bg-gray-500" : "bg-secondary text-secondary-foreground") + " inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-transparent text-white"}>
                  {isRunning ? "运行中" : isInstalled ? "已停止" : "未安装"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{data.version || data.message || "等待状态刷新"}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 !shadow-none transition-shadow duration-300 hover:!shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-muted/20 to-transparent border-b px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-foreground">服务控制</h3>
                <div className={(running ? "bg-green-600 dark:bg-green-500" : "bg-gray-500") + " inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-transparent text-white"}>
                  {running ? "运行中" : "已停止"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <InfoBit label="版本：" value={String(current.version || current.status || "-")} />
                <InfoBit label="CPU / 内存：" value={`${formatPercent(current.cpu ?? current.cpu_percent)} / ${typeof current.memory === "string" ? current.memory : formatBytes(current.memory_bytes ?? current.memory)}`} />
                <InfoBit label="运行时间：" value={displayUptime(current.uptime ?? current.uptime_seconds)} />
                <InfoBit label="PID：" value={String(current.pid || "-")} />
              </div>
              <div className="text-xs text-muted-foreground font-mono truncate">{current.config_path || current.path || (engine === "mihomo" ? "configs/mihomo/config.yaml" : "configs/singbox/config.json")}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void runAction("restart")}
                disabled={!!busy || !installed}
                className="inline-flex items-center justify-center text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-[8px] px-3 shadow-sm hover:shadow transition-shadow disabled:opacity-50"
              >
                <RefreshCw className={"h-4 w-4 mr-1.5 " + (busy === "restart" ? "animate-spin" : "")} />
                重启
              </button>
              <button
                onClick={() => void runAction(running ? "stop" : "start")}
                disabled={!!busy || !installed}
                className={(running ? "bg-destructive hover:bg-destructive/90" : "bg-green-600 hover:bg-green-700") + " inline-flex items-center justify-center text-sm font-medium h-9 rounded-[8px] px-3 shadow-sm hover:shadow transition-shadow text-white disabled:opacity-50"}
              >
                {running ? <Square className="h-4 w-4 mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
                {running ? "停止" : "启动"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {engine === "singbox" && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200">
          {current.message || "Sing-Box 当前为兼容占位状态，后端暂未实现完整管理能力。"}
        </div>
      )}
    </div>
  );
}
