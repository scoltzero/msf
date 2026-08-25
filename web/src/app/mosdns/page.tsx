import { useState } from "react";
import {
  Activity,
  ChartColumn,
  Cpu,
  FileText,
  List,
  MemoryStick,
  Search,
  Server,
  Settings,
  Wrench,
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
  { icon: ChartColumn, tone: "blue", title: "概述", description: "查看 MosDNS 服务的关键指标和详细统计", href: "/mosdns/overview" },
  { icon: List, tone: "orange", title: "规则管理", description: "管理 DNS 分流规则和黑白名单", href: "/mosdns/rules" },
  { icon: Server, tone: "teal", title: "客户端设置", description: "管理客户端代理权限，支持白名单和黑名单", href: "/mosdns/clients" },
  { icon: Search, tone: "pink", title: "DNS 日志", description: "查询和分析 DNS 请求日志", href: "/mosdns/query-log" },
  { icon: Activity, tone: "blue", title: "流量监控", description: "查看局域网设备实时流量和连接状态", href: "/mosdns/traffic" },
  { icon: Wrench, tone: "cyan", title: "系统功能", description: "管理缓存、路由任务和高级 DNS 设置", href: "/mosdns/system" },
  { icon: Settings, tone: "green", title: "配置管理", description: "管理配置文件、版本和运行参数", href: "/mosdns/service-config" },
  { icon: FileText, tone: "purple", title: "实时日志", description: "查看实时运行日志和历史记录", href: "/mosdns/logs" },
];

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function MosdnsPage() {
  const { toasts, showToast } = useToaster();
  const [busy, setBusy] = useState("");
  const statusQuery = useApiPath<any>("/api/v1/mosdns/status", [], 3000);
  const status = apiData<any>(statusQuery.data, {});
  const running = Boolean(status.running || status.status === "running");
  const version = String(status.version || "-");
  const cpu = status.cpu ?? status.cpu_percent;
  const memory = status.memory ?? status.memory_bytes;

  const runAction = async (action: "start" | "stop" | "restart") => {
    setBusy(action);
    try {
      const payload = await api<any>(`/api/v1/services/mosdns/${action}?wait=1&timeout=5`, { method: "POST" });
      if (payload.success === false) throw new Error(payload.error || "服务操作失败");
      showToast("服务操作完成");
      void statusQuery.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const stats: ManagementStat[] = [
    { icon: Cpu, tone: "blue", label: "CPU 使用率", value: formatPercent(cpu), progress: numericValue(cpu) },
    { icon: MemoryStick, tone: "purple", label: "内存占用", value: typeof memory === "string" ? memory : formatBytes(memory), detail: "MosDNS 进程实时占用" },
  ];

  return (
    <AppShell>
      <ToastStack toasts={toasts} />
      <ServiceManagementPage
        icon={Server}
        title="MosDNS 管理"
        description="DNS 服务管理与配置"
        version={version}
        running={running}
        busy={busy}
        info={[
          { label: "版本", value: version },
          { label: "CPU / 内存", value: `${formatPercent(cpu)} / ${typeof memory === "string" ? memory : formatBytes(memory)}` },
          { label: "运行时间", value: String(status.uptime ?? status.uptime_seconds ?? "-") },
          { label: "PID", value: String(status.pid || "-") },
        ]}
        stats={stats}
        modules={modules}
        onAction={(action) => void runAction(action)}
      />
    </AppShell>
  );
}
