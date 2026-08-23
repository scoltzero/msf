"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Network,
  RefreshCw,
  Server,
  Shield,
  X,
} from "lucide-react";
import { api, apiData, apiList } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";

export interface ConnectionRecord {
  id: string;
  host: string;
  proto: string;
  network: string;
  src: string;
  dst: string;
  inbound: string;
  type: string;
  process: string;
  rule: string;
  rulePayload: string;
  match: string;
  chain: string;
  chains: string[];
  down: string;
  up: string;
  dlTotal: string;
  ulTotal: string;
  ago: string;
  dur: string;
  start: string;
  downloadSpeedValue: number;
  uploadSpeedValue: number;
  downloadTotalValue: number;
  uploadTotalValue: number;
  startTimeValue: number;
  raw: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface ConnectionDetailProps {
  connection: ConnectionRecord;
  ended: boolean;
  activeConnections: ConnectionRecord[];
  onCloseConnection: (id: string) => Promise<void>;
  onRefreshConnections: () => Promise<void>;
  onDismiss: () => void;
  showToast: (message: string) => void;
}

export interface ProxyNodeInfo {
  name: string;
  type: string;
  protocol: string;
  delay: number;
}

export interface ProxyGroupInfo {
  name: string;
  type: string;
  current: string;
  nodes: ProxyNodeInfo[];
}

const AUTO_DISCONNECT_KEY = "msf-mihomo-connections.auto-disconnect";

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function arrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item && typeof item === "object" ? stringValue((item as Record<string, unknown>).name) : stringValue(item)).filter(Boolean);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function nodeFrom(value: unknown, fallbackName = ""): ProxyNodeInfo {
  const row = objectValue(value);
  const history = Array.isArray(row.history) ? row.history : [];
  const latest = objectValue(history[history.length - 1]);
  const delay = numberValue(row.delay ?? row.latency ?? latest.delay ?? latest.delayMs);
  return {
    name: stringValue(row.name || fallbackName),
    type: stringValue(row.type || row.kind || row.protocol),
    protocol: stringValue(row.protocol || row.protocols || row.network || row.type),
    delay,
  };
}

function unwrapProxyPayload(payload: unknown) {
  let data: any = apiData<any>(payload, payload);
  for (let index = 0; index < 3; index += 1) {
    if (data && typeof data === "object" && data.data && typeof data.data === "object" && !data.proxies) {
      data = data.data;
      continue;
    }
    break;
  }
  return objectValue(data);
}

/** Normalize both Mihomo's proxies map and API wrappers that expose groups separately. */
export function normalizeProxyGroups(payload: unknown): ProxyGroupInfo[] {
  const data = unwrapProxyPayload(payload);
  const proxyMap = objectValue(data.proxies || data.runtime?.proxies);
  const nodeMap = new Map<string, ProxyNodeInfo>();
  for (const [name, value] of Object.entries(proxyMap)) {
    const node = nodeFrom(value, name);
    if (node.name) nodeMap.set(node.name, node);
  }

  const groups: ProxyGroupInfo[] = [];
  const groupNames = new Set<string>();
  const addGroup = (raw: unknown, fallbackName = "") => {
    const row = objectValue(raw);
    const name = stringValue(row.name || fallbackName);
    if (!name || groupNames.has(name)) return;
    const names = arrayValue(row.all ?? row.proxies ?? row.nodes);
    const type = stringValue(row.type || row.kind || "Selector");
    const typeLower = type.toLowerCase();
    const isGroup = names.length > 0 || row.now != null || row.selected != null || /selector|url-test|fallback|load-balance|relay|smart/.test(typeLower);
    if (!isGroup) return;
    const current = stringValue(row.now || row.selected || row.current);
    const nodes = names.map((nodeName) => nodeMap.get(nodeName) || nodeFrom(proxyMap[nodeName], nodeName)).filter((node) => node.name);
    groups.push({ name, type, current, nodes });
    groupNames.add(name);
  };

  for (const [name, value] of Object.entries(proxyMap)) addGroup(value, name);
  for (const row of apiList<any>(data, ["groups", "proxy_groups", "proxyGroups", "items"])) addGroup(row);
  return groups;
}

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function formatDuration(start: string) {
  if (!start) return "-";
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed)) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function detailValue(connection: ConnectionRecord, key: string) {
  const metadata = connection.metadata || {};
  const value = (metadata as Record<string, unknown>)[key];
  return stringValue(value);
}

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/45 bg-muted/20 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 break-words text-[12px] leading-5 text-foreground", mono && "font-mono text-[11px]")}>{value || "-"}</div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-10 flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        active ? "bg-primary/12 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Overview({ connection, ended }: { connection: ConnectionRecord; ended: boolean }) {
  const source = connection.src || detailValue(connection, "sourceIP");
  const destination = connection.dst || detailValue(connection, "destinationIP");
  const process = connection.process || detailValue(connection, "process") || detailValue(connection, "processPath");
  const network = connection.network || connection.proto;
  const inbound = connection.inbound || connection.type || detailValue(connection, "type");
  const connectionType = connection.type || inbound || detailValue(connection, "type");
  const start = connection.start || stringValue(connection.raw.start);
  const duration = ended ? connection.dur : formatDuration(start);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InfoItem label="下载" value={`${connection.down} · ${connection.dlTotal}`} />
        <InfoItem label="上传" value={`${connection.up} · ${connection.ulTotal}`} />
        <InfoItem label="开始" value={formatDate(start)} />
        <InfoItem label="时长" value={duration} />
      </div>
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Network className="h-3.5 w-3.5 text-primary" />连接信息</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoItem label="目标" value={connection.host} mono />
          <InfoItem label="源 → 目的" value={`${source || "-"} → ${destination || "-"}`} mono />
          <InfoItem label="网络 / 类型" value={`${network || "-"} / ${connectionType || "-"}`} />
          <InfoItem label="主机 / 进程" value={`${connection.host || "-"} / ${process || "-"}`} mono />
          <InfoItem label="规则" value={connection.rule || "-"} />
          <InfoItem label="Payload" value={connection.rulePayload || connection.match || "-"} mono />
        </div>
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Shield className="h-3.5 w-3.5 text-primary" />代理链</div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/45 bg-muted/20 px-3 py-3">
          {connection.chains.length ? connection.chains.map((chain, index) => (
            <span key={`${chain}-${index}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
              {index > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : null}
              <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">{chain}</span>
            </span>
          )) : <span className="text-xs text-muted-foreground">-</span>}
        </div>
      </section>
      <section className="grid gap-2 sm:grid-cols-2">
        <InfoItem label="原始 ID" value={connection.id} mono />
        <InfoItem label="状态" value={ended ? "已结束（保留快照）" : "实时"} />
      </section>
    </div>
  );
}

function RawTab({ connection, showToast }: { connection: ConnectionRecord; showToast: (message: string) => void }) {
  const rawJson = useMemo(() => JSON.stringify(connection.raw || {}, null, 2), [connection.raw]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawJson);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = rawJson;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      showToast("原始数据已复制");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("复制失败，请手动选择");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground">Raw connection snapshot</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">保留后端返回的原始连接对象</div>
        </div>
        <button type="button" onClick={() => void copy()} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border/55 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </div>
      <pre className="max-h-[52vh] min-h-56 overflow-auto rounded-xl border border-border/50 bg-slate-950/[0.035] p-3 font-mono text-[11px] leading-5 text-foreground [tab-size:2] dark:bg-black/20">{rawJson}</pre>
    </div>
  );
}

function ProxyTab({
  connection,
  activeConnections,
  showToast,
  onRefreshConnections,
}: {
  connection: ConnectionRecord;
  activeConnections: ConnectionRecord[];
  showToast: (message: string) => void;
  onRefreshConnections: () => Promise<void>;
}) {
  const [groups, setGroups] = useState<ProxyGroupInfo[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [switchBusy, setSwitchBusy] = useState("");
  const [autoDisconnect, setAutoDisconnect] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api<any>("/api/v1/mihomo/proxies");
      const nextGroups = normalizeProxyGroups(payload);
      setGroups(nextGroups);
      setActiveGroup((current) => current && nextGroups.some((group) => group.name === current) ? current : nextGroups[0]?.name || "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载代理失败";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AUTO_DISCONNECT_KEY);
      if (stored != null) setAutoDisconnect(stored !== "false");
    } catch {
      // Storage can be disabled in private browsing; the in-memory default remains enabled.
    }
    void load();
  }, [load]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_DISCONNECT_KEY, String(autoDisconnect));
    } catch {
      // Ignore storage failures while keeping the setting for this dialog.
    }
  }, [autoDisconnect]);

  const chainGroups = useMemo(() => {
    const matching = groups.filter((group) => connection.chains.includes(group.name));
    return matching.length ? matching : groups;
  }, [connection.chains, groups]);

  useEffect(() => {
    if (!chainGroups.some((group) => group.name === activeGroup)) setActiveGroup(chainGroups[0]?.name || "");
  }, [activeGroup, chainGroups]);

  const selectedGroup = chainGroups.find((group) => group.name === activeGroup) || chainGroups[0];

  const switchNode = async (group: ProxyGroupInfo, node: ProxyNodeInfo) => {
    if (!group.name || !node.name || switchBusy) return;
    setSwitchBusy(`${group.name}:${node.name}`);
    try {
      await api(`/api/v1/mihomo/proxies/${encodeURIComponent(group.name)}`, {
        method: "PUT",
        body: JSON.stringify({ name: node.name }),
      });
      setGroups((items) => items.map((item) => item.name === group.name ? { ...item, current: node.name } : item));
      if (autoDisconnect) {
        const matching = activeConnections.filter((item) => item.chains.includes(group.name));
        const results = await Promise.allSettled(matching.map((item) => api(`/api/v1/mihomo/connections/${encodeURIComponent(item.id)}`, { method: "DELETE" })));
        if (results.some((result) => result.status === "rejected")) showToast("代理已切换，部分关联连接未能自动关闭");
        await onRefreshConnections();
      }
      showToast(`${group.name} → ${node.name}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "切换节点失败");
    } finally {
      setSwitchBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Server className="h-3.5 w-3.5 text-primary" />代理选择</div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {connection.chains.length ? connection.chains.map((chain, index) => <span key={`${chain}-${index}`} className="inline-flex items-center gap-1"><span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">{chain}</span>{index < connection.chains.length - 1 ? <ChevronRight className="h-3 w-3" /> : null}</span>) : "无代理链"}
          </div>
        </div>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border/45 px-2.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={autoDisconnect} onChange={(event) => setAutoDisconnect(event.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          自动断开关联连接
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在加载代理...</div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div>{error}</div>
          <button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/10"><RefreshCw className="h-3.5 w-3.5" />重试</button>
        </div>
      ) : !chainGroups.length ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/55 text-sm text-muted-foreground"><Server className="h-5 w-5" />没有可选择的代理组</div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-border/45 bg-muted/20 p-1 scrollbar-thin">
            {chainGroups.map((group) => (
              <button key={group.name} type="button" onClick={() => setActiveGroup(group.name)} className={cn("min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50", selectedGroup?.name === group.name ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {group.name}
              </button>
            ))}
          </div>
          {selectedGroup ? (
            <section className="space-y-2 rounded-xl border border-border/45 bg-muted/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">{selectedGroup.name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{selectedGroup.type || "Selector"} · 当前 <span className="font-medium text-foreground">{selectedGroup.current || "-"}</span></div>
                </div>
                <button type="button" onClick={() => void load()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="刷新代理列表"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button>
              </div>
              {selectedGroup.nodes.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectedGroup.nodes.map((node) => {
                    const selected = selectedGroup.current === node.name;
                    const busy = switchBusy === `${selectedGroup.name}:${node.name}`;
                    return (
                      <button key={node.name} type="button" disabled={Boolean(switchBusy)} onClick={() => void switchNode(selectedGroup, node)} className={cn("group min-h-[70px] rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-wait disabled:opacity-70", selected ? "border-primary/50 bg-primary/8" : "border-border/45 bg-card/35 hover:border-primary/35 hover:bg-muted/50")}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-semibold text-foreground">{node.name}</span>
                          {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                          {node.type ? <span>{node.type}</span> : null}
                          {node.protocol && node.protocol !== node.type ? <span>{node.protocol}</span> : null}
                          <span className={cn(node.delay > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{node.delay > 0 ? `${node.delay} ms` : "延迟 -"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="py-8 text-center text-xs text-muted-foreground">该代理组没有可选节点</div>}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ConnectionDetail({ connection, ended, activeConnections, onCloseConnection, onRefreshConnections, onDismiss, showToast }: ConnectionDetailProps) {
  const [tab, setTab] = useState<"overview" | "raw" | "proxy">("overview");
  const [closeBusy, setCloseBusy] = useState(false);

  const close = async () => {
    if (closeBusy) return;
    setCloseBusy(true);
    try {
      await onCloseConnection(connection.id);
      onDismiss();
    } catch {
      // The page-level close handler already reports the request failure.
    } finally {
      setCloseBusy(false);
    }
  };

  return (
    <ModalViewport onClose={onDismiss} className="max-[768px]:items-start max-[768px]:p-0 min-[769px]:p-4" overlayClassName="bg-transparent dark:bg-transparent">
      <GlassDialog className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none pt-[env(safe-area-inset-top)] min-[769px]:h-auto min-[769px]:max-h-[86vh] min-[769px]:max-w-[768px] min-[769px]:rounded-[24px] min-[769px]:pt-0">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/45 px-3 py-3 min-[769px]:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Network className="h-4 w-4" /></div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-bold text-foreground">{connection.host || connection.dst || "连接详情"}</h2>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", ended ? "bg-muted text-muted-foreground" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>{ended ? "已结束" : "实时"}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{connection.src || "-"} → {connection.dst || "-"}</div>
            </div>
          </div>
          <button type="button" disabled={closeBusy || ended} onClick={() => void close()} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40" title={ended ? "连接已结束" : "关闭连接"}>
            {closeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{closeBusy ? "关闭中" : "关闭"}</span>
          </button>
          <button type="button" onClick={onDismiss} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="关闭详情"><X className="h-4 w-4" /></button>
        </header>
        <nav role="tablist" aria-label="连接详情标签" className="flex shrink-0 gap-1 border-b border-border/45 px-3 py-2 min-[769px]:px-4">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>概览</TabButton>
          <TabButton active={tab === "raw"} onClick={() => setTab("raw")}>原始数据</TabButton>
          <TabButton active={tab === "proxy"} onClick={() => setTab("proxy")}>代理</TabButton>
        </nav>
        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 min-[769px]:px-4 min-[769px]:py-4">
          {tab === "overview" ? <Overview connection={connection} ended={ended} /> : null}
          {tab === "raw" ? <RawTab connection={connection} showToast={showToast} /> : null}
          {tab === "proxy" ? <ProxyTab connection={connection} activeConnections={activeConnections} showToast={showToast} onRefreshConnections={onRefreshConnections} /> : null}
        </main>
      </GlassDialog>
    </ModalViewport>
  );
}
