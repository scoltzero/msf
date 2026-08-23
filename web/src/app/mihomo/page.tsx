import { useState } from "react";
import {
  Activity,
  ChartColumn,
  Cpu,
  FileCode2,
  FileText,
  Gauge,
  MemoryStick,
  Network,
  Route,
  Share2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  ServiceManagementPage,
  type ManagementModule,
  type ManagementStat,
} from "@/components/management/ServiceManagementPage";
import { ToastStack, useToaster } from "@/components/Toaster";
import { api, apiData, formatBytes, formatPercent } from "@/lib/api";
import { useApiPath } from "@/lib/use-api";

const modules: ManagementModule[] = [
  { icon: ChartColumn, tone: "blue", title: "概述", description: "查看 Mihomo 运行状态、流量和核心指标", href: "/mihomo/overview" },
  { icon: Share2, tone: "orange", title: "代理节点", description: "管理代理组、选择节点并执行延迟测试", href: "/mihomo/proxies" },
  { icon: Route, tone: "teal", title: "规则管理", description: "查看代理规则、匹配类型和转发策略", href: "/mihomo/rules" },
  { icon: Network, tone: "pink", title: "连接管理", description: "查看活动连接、流量明细并关闭连接", href: "/mihomo/connections" },
  { icon: FileCode2, tone: "green", title: "配置管理", description: "管理 Mihomo 配置文件、订阅和运行参数", href: "/mihomo/config" },
  { icon: FileText, tone: "purple", title: "实时日志", description: "查看实时运行日志和历史记录", href: "/mihomo/logs" },
];

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function MihomoPage() {
  const { toasts, showToast } = useToaster();
  const [busy, setBusy] = useState("");
  const overviewQuery = useApiPath<any>("/api/v1/mihomo/overview", [], 3000);
  const overview = apiData<any>(overviewQuery.data, {});
  const service = overview.service || overview;
  const running = Boolean(overview.running ?? service.running ?? overview.status === "running");
  const version = String(overview.version || service.version || "-");
  const cpu = overview.cpu ?? service.cpu ?? service.cpu_percent;
  const memory = overview.memory ?? service.memory ?? service.memory_bytes;
  const uptime = overview.uptime ?? service.uptime ?? "-";
  const pid = overview.pid ?? service.pid ?? "-";
  const activeConnections = numericValue(overview.active_connections ?? overview.activeConnections ?? overview.connection_count);

  const runAction = async (action: "start" | "stop" | "restart") => {
    setBusy(action);
    try {
      const payload = await api<any>(`/api/v1/services/mihomo/${action}?wait=1&timeout=5`, { method: "POST" });
      if (payload.success === false) throw new Error(payload.error || "服务操作失败");
      showToast("服务操作完成");
      void overviewQuery.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const stats: ManagementStat[] = [
    { icon: Cpu, tone: "blue", label: "CPU 使用率", value: formatPercent(cpu), progress: numericValue(cpu) },
    { icon: MemoryStick, tone: "purple", label: "内存占用", value: typeof memory === "string" ? memory : formatBytes(memory), detail: "Mihomo 进程实时占用" },
    { icon: Activity, tone: "green", label: "活动连接", value: String(activeConnections), detail: "当前经由 Mihomo 处理的连接数" },
  ];

  return (
    <AppShell>
      <ToastStack toasts={toasts} />
      <ServiceManagementPage
        icon={Gauge}
        title="Mihomo 管理"
        description="代理服务管理与配置"
        version={version}
        running={running}
        busy={busy}
        info={[
          { label: "版本", value: version },
          { label: "CPU / 内存", value: `${formatPercent(cpu)} / ${typeof memory === "string" ? memory : formatBytes(memory)}` },
          { label: "运行时间", value: String(uptime) },
          { label: "PID", value: String(pid) },
        ]}
        stats={stats}
        modules={modules}
        onAction={(action) => void runAction(action)}
      />
    </AppShell>
  );
}
