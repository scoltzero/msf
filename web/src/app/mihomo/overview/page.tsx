"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Network,
  Settings,
  ShieldCheck,
  Terminal,
  Zap,
  ChartColumn,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import {
  ConnectionHistoryPanel,
  ConnectionSankey,
  FaviconLatencyTester,
  NetworkInfoPanel,
  normalizeOverviewConnections,
  OverviewStatCards,
  ProviderTrafficPanel,
  RuleHitChart,
  type OverviewConnectionHistoryPoint,
  type OverviewTrafficHistoryPoint,
} from "@/components/mihomo/overview/OverviewWidgets";
import { useMihomoTrafficStream } from "@/components/mihomo/overview/trafficStream";
import { EarthGlobeCard } from "@/components/mihomo/overview/EarthGlobeCard";
import { apiData, formatBytes, formatPercent } from "@/lib/api";
import { useApiPath } from "@/lib/use-api";

type Tone = "blue" | "orange" | "purple" | "slate";

type FieldItem = {
  label: string;
  value: string;
  valueClassName?: string;
  className?: string;
};

const toneClasses: Record<Tone, { icon: string; iconWrap: string; badge: string }> = {
  blue: {
    icon: "text-sky-600",
    iconWrap: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
    badge: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-800",
  },
  orange: {
    icon: "text-orange-600",
    iconWrap: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300",
    badge: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-800",
  },
  purple: {
    icon: "text-violet-600",
    iconWrap: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
    badge: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-800",
  },
  slate: {
    icon: "text-muted-foreground",
    iconWrap: "bg-muted text-muted-foreground",
    badge: "bg-muted text-muted-foreground ring-border",
  },
};

const HISTORY_SECONDS = 60;
const HISTORY_LIMIT = HISTORY_SECONDS + 2;

function makeInitialTrafficHistory(): OverviewTrafficHistoryPoint[] {
  const now = Date.now();
  return Array.from({ length: HISTORY_LIMIT }, (_, index) => ({
    timestamp: now - (HISTORY_LIMIT - 1 - index) * 1000,
    downloadSpeed: 0,
    uploadSpeed: 0,
    init: true,
  }));
}

function makeInitialConnectionHistory(): OverviewConnectionHistoryPoint[] {
  const now = Date.now();
  return Array.from({ length: HISTORY_LIMIT }, (_, index) => ({
    timestamp: now - (HISTORY_LIMIT - 1 - index) * 1000,
    connections: 0,
    init: true,
  }));
}

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampPercent(value: unknown) {
  return Math.max(0, Math.min(numberValue(value), 100));
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function maskAddress(value: string) {
  if (!value || value === "-") return "-";
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);
    return parts.length > 2 ? `${parts[0]}:${parts[1]}:***:***` : "***:***:***:***";
  }
  const parts = value.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  return "***";
}

function exitInfo(value: unknown) {
  const data = objectValue(value);
  const location = firstText(
    data.location,
    data.address,
    data.region,
    [data.country, data.province, data.city, data.isp].filter(Boolean).join(" ")
  );
  return {
    location: location || "未获取",
    ip: firstText(data.ip, data.query, data.address_ip, data.public_ip),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanYamlScalar(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutComment = trimmed.replace(/\s+#.*$/, "").trim();
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function yamlScalar(source: string, key: string) {
  if (!source) return "";
  const match = source.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m"));
  return match ? cleanYamlScalar(match[1]) : "";
}

function yamlSection(source: string, section: string) {
  if (!source) return "";
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${section}:`);
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function yamlSectionScalar(source: string, section: string, key: string) {
  const body = yamlSection(source, section);
  if (!body) return "";
  const match = body.match(new RegExp(`^\\s+${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m"));
  return match ? cleanYamlScalar(match[1]) : "";
}

function displayScalar(...values: unknown[]) {
  const text = firstText(...values);
  return text || "-";
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "on", "1", "enabled", "enable", "✓"].includes(normalized)) return true;
    if (["false", "no", "off", "0", "disabled", "disable", "×"].includes(normalized)) return false;
  }
  return null;
}

function displayBoolean(value: unknown) {
  const parsed = booleanValue(value);
  if (parsed === null) return "-";
  return parsed ? "✓" : "×";
}

function configField(source: string, key: string, section?: string) {
  return section ? yamlSectionScalar(source, section, key) : yamlScalar(source, key);
}

function buildMihomoConfigFields(fullData: Record<string, any>, data: Record<string, any>, configText: string) {
  const portsObject = objectValue(fullData.ports ?? data.ports);
  const portValue = (key: string, yamlKey: string) => displayScalar(portsObject[key], configField(configText, yamlKey));
  const dnsListen = configField(configText, "listen", "dns");
  const controller = displayScalar(fullData.external_controller, data.external_controller, configField(configText, "external-controller"));
  const tunEnabled = booleanValue(configField(configText, "enable", "tun")) === true;

  const ports: FieldItem[] = [
    { label: "HTTP", value: portValue("http", "port") },
    { label: "SOCKS", value: portValue("socks", "socks-port") },
    { label: "Mixed", value: portValue("mixed", "mixed-port") },
    { label: "Redir", value: portValue("redir", "redir-port") },
    { label: "TProxy", value: portValue("tproxy", "tproxy-port") },
    { label: "DNS", value: displayScalar(portsObject.dns, dnsListen) },
  ];

  const networkSettings: FieldItem[] = [
    { label: "绑定地址", value: displayScalar(configField(configText, "bind-address")) },
    { label: "网口", value: displayScalar(configField(configText, "interface-name")) },
    { label: "控制器", value: controller },
    { label: "IPv6", value: displayBoolean(configField(configText, "ipv6")) },
    { label: "路由标记", value: displayScalar(configField(configText, "routing-mark")) },
    { label: "进程查找", value: displayScalar(configField(configText, "find-process-mode")) },
  ];

  const runtimeFeatures: FieldItem[] = [
    { label: "统一延迟", value: displayBoolean(configField(configText, "unified-delay")) },
    { label: "TCP 并发", value: displayBoolean(configField(configText, "tcp-concurrent")) },
    { label: "流量嗅探", value: displayBoolean(configField(configText, "enable", "sniffer")) },
    { label: "GeoData", value: displayBoolean(configField(configText, "geodata-mode")) },
    { label: "GeoData 自动更新", value: displayBoolean(configField(configText, "geo-auto-update")) },
    { label: "GeoData 更新间隔", value: displayScalar(configField(configText, "geo-update-interval")) },
    { label: "Geo 加载器", value: displayScalar(configField(configText, "geodata-loader")) },
    { label: "Keep-Alive", value: displayBoolean(configField(configText, "keep-alive")) },
    { label: "KA Idle", value: displayScalar(configField(configText, "keep-alive-idle")) },
    { label: "KA Interval", value: displayScalar(configField(configText, "keep-alive-interval")) },
    { label: "ETag", value: displayBoolean(configField(configText, "etag-support")) },
    { label: "User-Agent", value: displayScalar(configField(configText, "global-client-fingerprint")) },
  ];

  const tunSettings: FieldItem[] = [
    { label: "已启用", value: displayBoolean(configField(configText, "enable", "tun")) },
    { label: "协议栈", value: displayScalar(configField(configText, "stack", "tun")) },
    { label: "自动路由", value: displayBoolean(configField(configText, "auto-route", "tun")) },
    { label: "自动检测", value: displayBoolean(configField(configText, "auto-detect-interface", "tun")) },
    { label: "设备名", value: displayScalar(configField(configText, "device", "tun")) },
    { label: "DNS 劫持", value: displayScalar(configField(configText, "dns-hijack", "tun")) },
    { label: "MTU", value: displayScalar(configField(configText, "mtu", "tun")) },
    { label: "严格路由", value: displayBoolean(configField(configText, "strict-route", "tun")) },
  ];

  return { ports, networkSettings, runtimeFeatures, tunSettings, tunEnabled };
}

function rangeButtonClass(active: boolean) {
  return `rounded-md px-2 py-1 text-xs font-medium transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
  }`;
}

function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <GlassSurface material="thick" className={`overflow-hidden rounded-[20px] text-card-foreground ${className}`}>
      {children}
    </GlassSurface>
  );
}

function FieldCard({ label, value, valueClassName = "", className = "" }: FieldItem) {
  return (
    <SolidPlate tone="strong" className={`min-w-0 rounded-lg px-2 py-2 ${className}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold leading-5 text-foreground ${valueClassName}`}>{value}</div>
    </SolidPlate>
  );
}

function HeaderIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone].iconWrap}`}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  tone,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  tone: Tone;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <Icon className={`h-4 w-4 ${toneClasses[tone].icon}`} />
        <h3 className="text-sm font-semibold leading-5 text-foreground">{title}</h3>
      </div>
      {actions}
    </div>
  );
}

function StatusPill({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${toneClasses[tone].badge}`}>
      {children}
    </span>
  );
}

function MiniTab({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-medium ${
        active
          ? "text-muted-foreground"
          : "text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function StatRow({
  label,
  value,
  bold,
  barClassName,
  barPercent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  barClassName?: string;
  barPercent?: number;
}) {
  return (
      <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm leading-5">
        <span className="text-muted-foreground">{label}</span>
        <span className={bold ? "text-sm font-semibold text-foreground" : "font-semibold text-foreground"}>{value}</span>
      </div>
      {barClassName ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${clampPercent(barPercent)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function ConfigGrid({ items, columns = "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5" }: { items: FieldItem[]; columns?: string }) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {items.map((item, index) => (
        <FieldCard key={`${item.label}-${item.value}-${index}`} {...item} />
      ))}
    </div>
  );
}

export default function MihomoOverviewPage() {
  const [trafficHistory, setTrafficHistory] = useState<OverviewTrafficHistoryPoint[]>(makeInitialTrafficHistory);
  const [connectionHistory, setConnectionHistory] = useState<OverviewConnectionHistoryPoint[]>(makeInitialConnectionHistory);
  const trafficStream = useMihomoTrafficStream();
  const overview = useApiPath<any>("/api/v1/mihomo/overview", [], 1000);
  const fullOverview = useApiPath<any>("/api/v1/mihomo/overview?full=1", [], 5000);
  const configQuery = useApiPath<any>("/api/v1/mihomo/config", [], 0);
  const networkQuery = useApiPath<any>("/api/v1/network/info", [], 0);
  const connectionsQuery = useApiPath<any>("/api/v1/mihomo/connections", [], 2000);
  const providersQuery = useApiPath<any>("/api/v1/mihomo/proxy-providers", [], 60000);
  const rulesQuery = useApiPath<any>("/api/v1/mihomo/rules?page_size=10000", [], 10000);
  const data = apiData<any>(overview.data, {});
  const fullData = apiData<any>(fullOverview.data, {});
  const configResponse = apiData<any>(configQuery.data, configQuery.data || {});
  const configText = String(configResponse.content || configResponse.config || "");
  const networkData = apiData<any>(networkQuery.data, {});
  const stats = data.stats || data;
  const running = Boolean(data.running || data.status === "running");
  const version = String(data.version || "-");
  const connections = String(data.activeConnections ?? data.active_connections ?? stats.activeConnections ?? stats.active_connections ?? 0);
  const overviewDownloadSpeedValue = Number(data.downloadSpeed ?? data.download_speed ?? stats.downloadSpeed ?? stats.download_speed ?? 0);
  const overviewUploadSpeedValue = Number(data.uploadSpeed ?? data.upload_speed ?? stats.uploadSpeed ?? stats.upload_speed ?? 0);
  const downloadSpeedValue = trafficStream.sample?.downloadSpeed ?? overviewDownloadSpeedValue;
  const uploadSpeedValue = trafficStream.sample?.uploadSpeed ?? overviewUploadSpeedValue;
  const connectionCount = Number(data.activeConnections ?? data.active_connections ?? stats.activeConnections ?? stats.active_connections ?? 0);
  const cpuPercentValue = numberValue(data.cpu ?? data.cpu_percent ?? stats.cpu ?? stats.cpu_percent);
  const memoryPercentValue = Number(data.memory_percent ?? data.mem_percent ?? stats.memory_percent ?? stats.mem_percent);
  const memoryValue = numberValue(data.memory_bytes ?? (typeof data.memory === "number" ? data.memory : stats.memory));
  const memory = typeof data.memory === "string" ? data.memory : formatBytes(memoryValue);
  const { ports, networkSettings, runtimeFeatures, tunSettings, tunEnabled } = useMemo(
    () => buildMihomoConfigFields(fullData, data, configText),
    [fullData, data, configText]
  );
  const domesticExit = exitInfo(networkData.ipip ?? networkData.domestic ?? networkData.china_exit);
  const internationalExit = exitInfo(networkData.ipsb ?? networkData.international ?? networkData.global_exit);
  const connectionPayload = apiData<any>(connectionsQuery.data, {});
  const providerPayload = apiData<any>(providersQuery.data, {});
  const rulePayload = apiData<any>(rulesQuery.data, {});
  const connectionRows = useMemo(
    () => normalizeOverviewConnections(connectionPayload),
    [connectionPayload],
  );

  useEffect(() => {
    if (!trafficStream.sample) return;
    setTrafficHistory((prev) => [
      ...prev,
      {
        timestamp: trafficStream.sample!.at,
        downloadSpeed: trafficStream.sample!.downloadSpeed,
        uploadSpeed: trafficStream.sample!.uploadSpeed,
      },
    ].slice(-HISTORY_LIMIT));
  }, [trafficStream.sample]);

  useEffect(() => {
    if (!overview.data) return;
    setConnectionHistory((prev) => [
      ...prev,
      {
        timestamp: Date.now(),
        connections: connectionCount,
      },
    ].slice(-HISTORY_LIMIT));
  }, [overview.data, connectionCount]);

  useEffect(() => {
    if (trafficStream.connected || trafficStream.sample) return;
    if (!overview.data) return;
    setTrafficHistory((prev) => [
      ...prev,
      {
        timestamp: Date.now(),
        downloadSpeed: downloadSpeedValue,
        uploadSpeed: uploadSpeedValue,
      },
    ].slice(-HISTORY_LIMIT));
  }, [overview.data, overviewDownloadSpeedValue, overviewUploadSpeedValue, trafficStream.connected, trafficStream.sample]);

  return (
    <AppShell fillViewport contentUnderHeader>
      <div className="space-y-6 pb-4 pt-20 pr-1 animate-fade-in md:pt-[85px]">
        <PageHeader
          icon={ChartColumn}
          title="Mihomo 概览"
          description="代理服务运行状态、流量与核心指标"
          actions={(
            <>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/25">{version}</span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className={(running ? "bg-emerald-500 animate-pulse" : "bg-gray-400") + " h-2 w-2 rounded-full"} />
                {running ? "running" : "stopped"}
              </span>
            </>
          )}
        />

        <OverviewStatCards
          downloadSpeed={downloadSpeedValue}
          uploadSpeed={uploadSpeedValue}
          connections={connectionCount}
          downloadTotal={numberValue(data.downloadTotal ?? data.download_total ?? stats.downloadTotal ?? stats.download_total)}
          uploadTotal={numberValue(data.uploadTotal ?? data.upload_total ?? stats.uploadTotal ?? stats.upload_total)}
          memory={memoryValue || memory}
          trafficHistory={trafficHistory}
          connectionHistory={connectionHistory}
        />

        <GlassSurface material="thick" className="@container rounded-2xl p-3"><div className="grid items-stretch gap-3 @min-[768px]:grid-cols-2"><FaviconLatencyTester /><NetworkInfoPanel domestic={domesticExit} international={internationalExit} loading={networkQuery.loading} onRefresh={() => void networkQuery.reload()} /></div></GlassSurface>

        <EarthGlobeCard connections={connectionRows} />
        <ConnectionSankey connections={connectionRows} />
        <ProviderTrafficPanel payload={providerPayload} />
        <ConnectionHistoryPanel connections={connectionRows} />
        <RuleHitChart payload={rulePayload} />

        <Card>
          <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50">
            <div className="flex items-center gap-2">
              <HeaderIcon icon={Settings} tone="blue" />
              <div>
                <h2 className="font-semibold">高级运行信息</h2>
                <p className="text-xs text-muted-foreground">点击展开核心参数、端口与网络设置</p>
              </div>
            </div>
            <div className="flex gap-1.5">
              <StatusPill tone="blue">Rule</StatusPill>
              <StatusPill>Info</StatusPill>
            </div>
          </summary>

          <div className="grid grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-2">
            <section className="space-y-2">
              <SectionHeader
                icon={Network}
                title="代理端口"
                tone="blue"
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground">
                    <MiniTab active>
                      <Terminal className="mr-1 h-3.5 w-3.5" />
                      Linux/Mac
                    </MiniTab>
                    <MiniTab>PowerShell</MiniTab>
                  </div>
                }
              />
              <ConfigGrid items={ports} columns="grid-cols-3 sm:grid-cols-5" />
            </section>

            <section className="space-y-2">
              <SectionHeader
                icon={Network}
                title="网络配置"
                tone="blue"
                actions={<span className="text-xs text-muted-foreground"><span className="text-emerald-500">●</span> 已启用</span>}
              />
              <ConfigGrid items={networkSettings} columns="grid-cols-2 sm:grid-cols-3" />
            </section>

            <section className="space-y-2 lg:col-span-2">
              <SectionHeader icon={Zap} title="运行特性" tone="orange" />
              <ConfigGrid items={runtimeFeatures} columns="grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" />
            </section>

            <section className="space-y-2 lg:col-span-2">
              <SectionHeader
                icon={ShieldCheck}
                title="TUN 模式"
                tone="purple"
                actions={
                  <StatusPill>
                    <span className={`h-1.5 w-1.5 rounded-full ${tunEnabled ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                    {tunEnabled ? "已启用" : "未启用"}
                  </StatusPill>
                }
              />
              <ConfigGrid items={tunSettings} columns="grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" />
            </section>
          </div>
          </details>
        </Card>
      </div>
    </AppShell>
  );
}
