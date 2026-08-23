"use client";

import "./clients.css";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Users,
  ShieldOff,
  ShieldCheck,
  ShieldX,
  Plus,
  Square,
  CheckSquare,
  RefreshCw,
  Search,
  HelpCircle,
  GripVertical,
  X,
  Check,
  CircleCheckBig,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";
import { ToastStack, type ToastItem } from "@/components/rules/RuleDialogs";
import { api, apiData, apiList } from "@/lib/api";

type ClientStatus = "allow" | "deny" | "disabled" | "unscanned" | string;

interface Client {
  id: string;
  ip: string;
  mac: string;
  name: string;
  hostname: string;
  source: string;
  status: ClientStatus;
  queryCount: number;
  iface: string;
  online: boolean;
  lastSeen: string;
  updatedAt: string;
  ago: string;
  inClientList: boolean;
}

const modeOptions = [
  { key: "off", label: "关闭", icon: ShieldOff },
  { key: "white", label: "白名单", icon: ShieldCheck },
  { key: "black", label: "黑名单", icon: ShieldX },
] as const;

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatAgo(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return "未记录";
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return raw;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 90) return `${days} 天前`;
  return new Date(time).toLocaleString();
}

function normalizeStatus(value: unknown): ClientStatus {
  const status = stringValue(value).trim().toLowerCase();
  return status || "unscanned";
}

function statusBadge(status: ClientStatus) {
  switch (status) {
    case "allow":
      return { text: "白名单", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" };
    case "deny":
      return { text: "黑名单", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" };
    case "disabled":
      return { text: "关闭", className: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-300" };
    default:
      return { text: status || "未分类", className: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300" };
  }
}

function normalizeClientSource(source: unknown) {
  const parts = stringValue(source)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      if (["ip", "neigh", "ip_neigh", "proc_arp", "arp"].includes(item)) return "arp";
      if (["dnslog", "dns_log", "querylog", "query_log", "mosdns"].includes(item)) return "mosdns";
      return item;
    });
  return [...new Set(parts)].join(",");
}

function sourceBadge(source: string) {
  const normalized = normalizeClientSource(source);
  if (normalized === "mosdns") return { text: "mosdns", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
  if (normalized === "arp") return { text: "arp", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" };
  if (normalized.includes("mosdns") && normalized.includes("arp")) return { text: "arp,mosdns", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" };
  return { text: normalized || "scan", className: "bg-muted text-muted-foreground" };
}

function normalizeMode(raw: unknown): "off" | "white" | "black" {
  const mode = stringValue(raw).toLowerCase();
  if (mode.includes("allow") || mode.includes("white")) return "white";
  if (mode.includes("deny") || mode.includes("black") || mode.includes("proxy")) return "black";
  return "off";
}

function normalizeClient(row: any): Client {
  const ip = stringValue(row.ip);
  const mac = stringValue(row.mac);
  const hostname = stringValue(row.hostname);
  const name = stringValue(row.custom_name || row.display_name || row.name || hostname || ip || mac);
  const lastSeen = stringValue(row.last_seen_at || row.last_seen || row.updated_at || row.created_at);
  return {
    id: stringValue(row.id || ip || mac),
    ip,
    mac,
    name: name || "-",
    hostname,
    source: normalizeClientSource(row.source || row.vendor || "runtime"),
    status: normalizeStatus(row.status || row.type || row.zone),
    queryCount: numberValue(row.query_count || row.queries),
    iface: stringValue(row.interface || row.iface),
    online: Boolean(row.is_online ?? row.online),
    lastSeen,
    updatedAt: stringValue(row.updated_at),
    ago: formatAgo(lastSeen),
    inClientList: Boolean(row.in_client_ip_list ?? row.in_list ?? row.listed),
  };
}

function clientKey(client: Client) {
  return client.id || client.ip || client.mac;
}

function createClientDragPreview(client: Client, directionLabel: string) {
  const preview = document.createElement("div");
  preview.dataset.clientDragPreview = "true";
  preview.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:-10000px",
    "width:320px",
    "display:flex",
    "align-items:center",
    "gap:10px",
    "padding:10px 12px",
    "border:1px solid hsl(var(--border))",
    "border-radius:10px",
    "background:hsl(var(--card) / 0.88)",
    "color:hsl(var(--card-foreground))",
    "box-shadow:0 14px 32px hsl(var(--foreground) / 0.18)",
    "backdrop-filter:blur(10px)",
    "-webkit-backdrop-filter:blur(10px)",
    "opacity:0.92",
    "pointer-events:none",
    "z-index:2147483647",
  ].join(";");
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    preview.style.transform = "rotate(1deg) scale(0.985)";
  }

  const onlineDot = document.createElement("span");
  onlineDot.style.cssText = [
    "width:9px",
    "height:9px",
    "flex:0 0 auto",
    "border-radius:999px",
    `background:${client.online ? "#22c55e" : "#9ca3af"}`,
    "box-shadow:0 0 0 3px hsl(var(--card) / 0.8)",
  ].join(";");

  const content = document.createElement("span");
  content.style.cssText = "display:flex;min-width:0;flex:1;flex-direction:column;gap:2px";

  const title = document.createElement("strong");
  title.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px";
  title.textContent = client.name || client.ip || client.hostname || "未知客户端";

  const detail = document.createElement("span");
  detail.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:hsl(var(--muted-foreground))";
  detail.textContent = [client.ip, directionLabel].filter(Boolean).join("  ·  ");

  content.append(title, detail);
  preview.append(onlineDot, content);
  document.body.append(preview);
  return preview;
}

function ClientCard({
  client,
  inList,
  onAdd,
  onRemove,
  variant,
  multiSelect,
  selected,
  onSelect,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  client: Client;
  inList?: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
  variant: "list" | "active";
  multiSelect?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  busy?: boolean;
  dragging?: boolean;
  onDragStart?: (event: DragEvent<HTMLSpanElement>) => void;
  onDragEnd?: () => void;
}) {
  const badge = statusBadge(client.status);
  const source = sourceBadge(client.source);
  const activeBadge = client.status === "unscanned" && client.source ? source : badge;
  const title = client.ip || client.name || client.hostname || "-";
  const detail = [
    client.ip,
    client.ago,
  ].filter(Boolean).join("  ·  ");

  return (
    <div
      className={cn(
        "relative group transition-[opacity,transform] duration-150 motion-reduce:transition-none",
        dragging && "opacity-45 scale-[0.985]"
      )}
      data-client-dragging={dragging || undefined}
    >
      <SolidPlate
        tone="subtle"
        onClick={multiSelect ? onSelect : undefined}
        className={cn(
          "rounded-md px-2 py-1.5 transition-[border-color,box-shadow] hover:border-primary hover:shadow-sm cursor-pointer",
          selected && "ring-2 ring-primary border-primary"
        )}
      >
        <div className="flex items-center gap-2 min-h-[38px]">
          {multiSelect && variant === "list" && (
            <span className={cn("flex-shrink-0", selected ? "text-primary" : "text-muted-foreground")}>
              {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </span>
          )}
          <div className="relative flex-shrink-0">
            <HelpCircle className="h-6 w-6 text-primary/80" />
            <span className={cn("absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-card", client.online ? "bg-green-500" : "bg-gray-400")} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground text-sm leading-5 truncate" title={title}>{title}</span>
              <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium leading-3", activeBadge.className)}>
                {activeBadge.text}
              </span>
            </div>
            <div className="text-[11px] leading-4 text-muted-foreground truncate">
              {detail || client.source || "暂无最近活动"}
            </div>
          </div>
          {!multiSelect && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {variant === "list" ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onAdd?.(); }}
                  disabled={inList || busy}
                  className={cn(
                    "inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors disabled:opacity-60",
                    inList
                      ? "bg-muted text-muted-foreground/40 cursor-default"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  title={inList ? "已在当前名单" : "加入当前名单"}
                >
                  {inList ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
                  disabled={busy}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
                  title="移出当前名单"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {onDragStart ? (
                <span
                  draggable
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  className="inline-flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground active:cursor-grabbing"
                  title={variant === "list" ? "拖动到当前名单" : "拖回客户端列表"}
                  aria-label={variant === "list" ? `拖动 ${title} 到当前名单` : `拖动 ${title} 回客户端列表`}
                  data-client-drag-handle
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          )}
        </div>
      </SolidPlate>
    </div>
  );
}

export default function MosdnsClientsPage() {
  const [mode, setMode] = useState<"off" | "white" | "black">("off");
  const [modeUpdating, setModeUpdating] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [newIp, setNewIp] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [draggedKey, setDraggedKey] = useState("");
  const [dragOrigin, setDragOrigin] = useState<"list" | "active" | "">("");
  const [requiresScan, setRequiresScan] = useState(false);
  const [lastScanAt, setLastScanAt] = useState("");

  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clientsPayload, modePayload] = await Promise.all([
        api<any>("/api/v1/mosdns/clients?limit=500&sort=is_online&order=desc"),
        api<any>("/api/v1/mosdns/client-proxy-mode").catch(() => null),
      ]);
      const data = apiData<any>(clientsPayload, clientsPayload);
      setClients(apiList<any>(data, ["clients", "items", "rows", "list", "data"]).map(normalizeClient));
      setRequiresScan(Boolean(data.requires_scan ?? clientsPayload?.requires_scan));
      setLastScanAt(stringValue(data.last_scan_at || clientsPayload?.last_scan_at));
      if (modePayload) {
        setMode(normalizeMode(apiData<any>(modePayload, modePayload).mode));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "加载客户端失败");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = terms.length
      ? clients.filter((client) => {
          const haystack = [client.ip, client.mac, client.name, client.hostname, client.source, client.iface].join(" ").toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : clients;
    return [...list].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.ip.localeCompare(b.ip, undefined, { numeric: true });
    });
  }, [clients, query]);

  const activeList = useMemo(() => clients.filter((c) => c.inClientList), [clients]);
  const activeListStatus: ClientStatus = mode === "black" ? "deny" : "allow";
  const activeMeta = mode === "black"
    ? {
        title: "黑名单",
        icon: ShieldX,
        border: "border-red-500/30",
        bg: "bg-red-500/5",
        iconClass: "text-red-600 dark:text-red-400",
        empty: "暂无黑名单客户端",
        note: "黑名单中的客户端不可使用代理",
      }
    : {
        title: "白名单",
        icon: CircleCheckBig,
        border: "border-green-500/30",
        bg: "bg-green-500/5",
        iconClass: "text-green-600 dark:text-green-400",
        empty: "暂无白名单客户端",
        note: "白名单中的客户端可使用代理",
      };
  const ActiveListIcon = activeMeta.icon;

  const toggleSelect = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const moveClient = async (client: Client, status: ClientStatus) => {
    const key = clientKey(client);
    setBusyKey(key);
    try {
      await api(`/api/v1/mosdns/clients/${encodeURIComponent(key)}/move`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      showToast(status === "unscanned" ? "已移出当前名单" : "已加入当前名单");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新客户端失败");
    } finally {
      setBusyKey("");
    }
  };

  const startClientDrag = (event: DragEvent<HTMLSpanElement>, client: Client, origin: "list" | "active") => {
    const key = clientKey(client);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    const directionLabel = origin === "active"
      ? "移出当前名单"
      : `加入${mode === "black" ? "黑名单" : "白名单"}`;
    const preview = createClientDragPreview(client, directionLabel);
    event.dataTransfer.setDragImage(preview, 28, 24);
    window.setTimeout(() => preview.remove(), 0);
    setDraggedKey(key);
    setDragOrigin(origin);
  };

  const endClientDrag = () => {
    setDraggedKey("");
    setDragOrigin("");
  };

  const dropClient = (event: DragEvent<HTMLDivElement>, status: ClientStatus) => {
    event.preventDefault();
    const key = event.dataTransfer.getData("text/plain") || draggedKey;
    const client = clients.find((item) => clientKey(item) === key);
    endClientDrag();
    if (!client) return;
    const movingIntoList = status !== "unscanned";
    if (client.inClientList === movingIntoList) return;
    void moveClient(client, status);
  };

  const draggedClient = draggedKey ? clients.find((client) => clientKey(client) === draggedKey) : undefined;

  const moveSelected = async (status: ClientStatus) => {
    const targets = clients.filter((client) => selected.has(clientKey(client)));
    if (!targets.length) return;
    setBusyKey("selected");
    try {
      await Promise.all(targets.map((client) =>
        api(`/api/v1/mosdns/clients/${encodeURIComponent(clientKey(client))}/move`, {
          method: "POST",
          body: JSON.stringify({ status }),
        })
      ));
      setSelected(new Set());
      showToast(status === "unscanned" ? "已批量移出当前名单" : "已批量加入当前名单");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "批量更新失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleAdd = async () => {
    const ip = newIp.trim();
    if (!ip) return;
    setBusyKey("add");
    try {
      await api("/api/v1/mosdns/clients", {
        method: "POST",
        body: JSON.stringify({ ip, type: "unscanned" }),
      });
      showToast("已添加客户端");
      setNewIp("");
      setShowAdd(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "添加客户端失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleModeChange = async (nextMode: "off" | "white" | "black") => {
    if (nextMode === mode || modeUpdating) return;
    const previous = mode;
    setMode(nextMode);
    setModeUpdating(true);
    try {
      await api("/api/v1/mosdns/client-proxy-mode", {
        method: "POST",
        body: JSON.stringify({ mode: nextMode }),
      });
      showToast("客户端代理模式已更新");
    } catch (err) {
      setMode(previous);
      showToast(err instanceof Error ? err.message : "更新模式失败");
    } finally {
      setModeUpdating(false);
    }
  };

  const scan = async (reset = false) => {
    setBusyKey(reset ? "scan-reset" : "scan");
    try {
      if (reset) {
        await api("/api/v1/mosdns/clients/scan/reset", { method: "POST" });
      }
      await api("/api/v1/mosdns/clients/scan", { method: "POST" });
      showToast("扫描完成");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <AppShell>
      <div className="space-y-2 animate-fade-in">
        <WorkbenchHeader
          icon={Users}
          title="客户端设置"
          description="客户端代理权限、白名单与黑名单"
          status={(
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", requiresScan ? "bg-amber-500" : "bg-green-500")} />
            {requiresScan ? "需要扫描" : lastScanAt ? `上次扫描 ${formatAgo(lastScanAt)}` : loading ? "加载中" : "已同步"}
            </div>
          )}
          summary={(
            <div
              className={cn("mosdns-mode-switch", `mosdns-mode-switch--${mode}`)}
              aria-label="客户端代理模式"
              aria-busy={modeUpdating}
            >
              <span className="mosdns-mode-switch__indicator" aria-hidden="true">
                <span className="mosdns-mode-button__lights">
                  {Array.from({ length: 4 }, (_, index) => (
                    <span className="mosdns-mode-button__light" key={index} />
                  ))}
                </span>
              </span>
              {modeOptions.map((m) => {
                const Icon = m.icon;
                const isOn = m.key === mode;
                return (
                  <button
                    key={m.key}
                    onClick={() => void handleModeChange(m.key)}
                    aria-pressed={isOn}
                    disabled={modeUpdating}
                    className={cn(
                      "mosdns-mode-button",
                      `mosdns-mode-button--${m.key}`,
                      isOn && "mosdns-mode-button--selected"
                    )}
                  >
                    <span className="mosdns-mode-button__label">
                      <Icon className="h-3.5 w-3.5" />{m.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />

        <div className="rounded-sm border border-foreground/80 bg-card px-2 py-1 text-xs text-muted-foreground">
          拖拽客户端到右侧名单区域，或点击&quot;添加&quot;按钮
        </div>

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex h-9 items-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />新增客户端
              </button>
              <button
                onClick={() => { setMultiSelect((v) => !v); setSelected(new Set()); }}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 px-3 rounded-md text-sm font-medium border transition-colors",
                  multiSelect
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                {multiSelect ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                多选{multiSelect && selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
              {multiSelect && selected.size > 0 && (
                <button
                  onClick={() => void moveSelected(activeListStatus)}
                  disabled={busyKey === "selected"}
                  className="inline-flex h-9 items-center gap-1.5 px-3 rounded-md border border-green-500/50 text-green-700 dark:text-green-300 text-sm font-medium hover:bg-green-500/10 transition-colors disabled:opacity-60"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />加入当前名单
                </button>
              )}
              <button
                onClick={() => void scan(false)}
                disabled={busyKey === "scan"}
                className="inline-flex h-9 items-center gap-1.5 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors ml-auto disabled:opacity-60"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", busyKey === "scan" && "animate-spin")} />重新扫描
              </button>
              <button
                onClick={() => void scan(true)}
                disabled={busyKey === "scan-reset"}
                className="inline-flex h-9 items-center gap-1.5 px-3 rounded-md border border-destructive/70 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors disabled:opacity-60"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", busyKey === "scan-reset" && "animate-spin")} />清空并扫描
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索客户端（IP、MAC、主机名）..."
                className="w-full h-8 pl-9 pr-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">客户端列表 <span className="text-muted-foreground">({filtered.length} / {clients.length})</span></span>
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">在线优先 · IP 正序</span>
            </div>
            <div
              className={cn(
                "min-h-16 space-y-1.5 rounded-md transition-[background-color,box-shadow]",
                draggedClient?.inClientList && "bg-primary/5 ring-2 ring-primary/35"
              )}
              onDragOver={(event) => {
                if (!draggedClient?.inClientList) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => dropClient(event, "unscanned")}
            >
              {loading && clients.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">正在加载客户端...</div>
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">暂无客户端</div>
              ) : (
                filtered.map((c) => {
                  const key = clientKey(c);
                  return (
                    <ClientCard
                      key={key}
                      client={c}
                      variant="list"
                      inList={c.inClientList}
                      onAdd={() => void moveClient(c, activeListStatus)}
                      multiSelect={multiSelect}
                      selected={selected.has(key)}
                      onSelect={() => toggleSelect(key)}
                      busy={busyKey === key}
                      dragging={draggedKey === key && dragOrigin === "list"}
                      onDragStart={multiSelect || c.inClientList ? undefined : (event) => startClientDrag(event, c, "list")}
                      onDragEnd={endClientDrag}
                    />
                  );
                })
              )}
            </div>
          </div>

          {mode === "off" ? (
            <div className="rounded-md border-2 border-dashed border-border bg-muted/10 p-6 min-h-[300px] flex flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-foreground">代理策略已关闭</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                当前所有客户端均可使用代理。如需限制特定客户端，请切换到白名单或黑名单模式。
              </p>
            </div>
          ) : (
            <div
              className={cn(
                "rounded-md border-2 border-dashed p-2.5 space-y-2 transition-[background-color,box-shadow]",
                activeMeta.border,
                activeMeta.bg,
                draggedClient && !draggedClient.inClientList && "ring-2 ring-primary/45"
              )}
              onDragOver={(event) => {
                if (!draggedClient || draggedClient.inClientList) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => dropClient(event, activeListStatus)}
            >
              <div className="flex items-center gap-2">
                <ActiveListIcon className={cn("h-4 w-4", activeMeta.iconClass)} />
                <h2 className="text-sm font-semibold text-foreground">{activeMeta.title}</h2>
                <span className="text-xs text-muted-foreground">({activeList.length})</span>
              </div>
              <div className="space-y-1.5">
                {activeList.length === 0 ? (
                  <div className={cn("rounded-md border bg-card/60 p-4 text-center text-sm text-muted-foreground", activeMeta.border)}>{activeMeta.empty}</div>
                ) : (
                  activeList.map((c) => {
                    const key = clientKey(c);
                    return (
                      <ClientCard
                        key={key}
                        client={c}
                        variant="active"
                        onRemove={() => void moveClient(c, "unscanned")}
                        busy={busyKey === key}
                        dragging={draggedKey === key && dragOrigin === "active"}
                        onDragStart={(event) => startClientDrag(event, c, "active")}
                        onDragEnd={endClientDrag}
                      />
                    );
                  })
                )}
              </div>
              <div className={cn("flex items-center gap-2 text-xs text-muted-foreground px-2 py-1.5 rounded border", activeMeta.border)}>
                <ActiveListIcon className={cn("h-3.5 w-3.5", activeMeta.iconClass)} />
                {activeMeta.note}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <ModalViewport onClose={() => setShowAdd(false)}>
          <div role="dialog" aria-modal="true" className="relative w-full max-w-md bg-card rounded-2xl border-2 border-border/50 shadow-2xl p-6 animate-scale-in space-y-4">
            <h2 className="text-lg font-bold text-foreground">新增客户端</h2>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">客户端 IP</label>
              <input
                autoFocus
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
                placeholder="例如: 192.168.10.100"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors">取消</button>
              <button disabled={busyKey === "add"} onClick={() => void handleAdd()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">添加</button>
            </div>
          </div>
        </ModalViewport>
      )}

      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
