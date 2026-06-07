"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings,
  FileText,
  FileCode,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  CircleCheckBig,
  Save,
  Folder,
  Package,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { YamlEditor } from "@/components/mihomo/YamlEditor";
import { MosdnsHero } from "@/components/mosdns/MosdnsHero";
import { ServiceControlCard } from "@/components/mosdns/ServiceControlCard";
import { useToaster, ToastStack } from "@/components/Toaster";
import { api, apiData, apiList, formatBytes, formatPercent, getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FileNode {
  name: string;
  path: string;
  type?: string;
  size?: number;
  modified?: string;
  children?: FileNode[];
}

interface ServiceInfo {
  name?: string;
  running?: boolean;
  status?: string;
  pid?: number;
  uptime_seconds?: number;
  cpu_percent?: number;
  memory_bytes?: number;
  version?: string;
}

const toolBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50";

function isDirectory(node: FileNode) {
  return node.type === "directory" || node.type === "folder" || Boolean(node.children?.length);
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => (isDirectory(node) ? flattenFiles(node.children || []) : [node]));
}

function displayPath(path?: string) {
  return path || "config.yaml";
}

function formatUptime(seconds?: number) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function serviceRunning(service?: ServiceInfo) {
  const status = String(service?.status || "").toLowerCase();
  return service?.running === true || ["running", "active", "ok"].includes(status);
}

function FileTree({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: FileNode[];
  selectedPath: string;
  onSelect: (node: FileNode) => void;
  depth?: number;
}) {
  return (
    <div className={depth === 0 ? "mt-1 space-y-0.5" : "space-y-0.5"}>
      {nodes.map((node) => {
        const directory = isDirectory(node);
        const active = node.path === selectedPath;
        return (
          <div key={node.path || node.name}>
            <button
              onClick={() => !directory && onSelect(node)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent/60 transition-colors",
                active ? "bg-primary/10 text-primary font-medium" : directory ? "text-foreground" : "text-muted-foreground"
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {directory ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <span className="h-3.5 w-3.5 flex-shrink-0" />}
              {directory ? <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <FileCode className="h-4 w-4 flex-shrink-0" />}
              <span className="truncate">{node.name}</span>
            </button>
            {directory && node.children?.length ? <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ServiceConfigPage() {
  const [collapsed, setCollapsed] = useState(false);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [service, setService] = useState<ServiceInfo | undefined>();
  const [serviceBusy, setServiceBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const { toasts, showToast } = useToaster();

  const files = useMemo(() => flattenFiles(tree), [tree]);

  const loadService = useCallback(async () => {
    try {
      const payload = await api("/api/v1/services/mosdns");
      setService(apiData<ServiceInfo>(payload, payload as ServiceInfo));
    } catch {
      try {
        const payload = await api("/api/v1/services");
        setService(apiList<ServiceInfo>(payload, ["data", "services", "items"]).find((item) => item.name === "mosdns"));
      } catch {
        setService(undefined);
      }
    }
  }, []);

  const loadFile = useCallback(async (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const payload = await api(`/api/v1/mosdns/config/file${query}`);
    const data = apiData<{ content?: string; path?: string }>(payload, payload as { content?: string; path?: string });
    setSelectedPath(data?.path || path || "config.yaml");
    setContent(String(data?.content || ""));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [treePayload] = await Promise.all([api("/api/v1/mosdns/config/files"), loadService()]);
      const data = apiData<FileNode[] | FileNode>(treePayload, treePayload as FileNode[] | FileNode);
      const nodes = Array.isArray(data) ? data : data?.children || [];
      setTree(nodes);
      const firstConfig = flattenFiles(nodes).find((file) => file.name === "config.yaml") || flattenFiles(nodes).find((file) => file.name.endsWith(".yaml") || file.name.endsWith(".yml"));
      await loadFile(firstConfig?.path);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配置文件加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadFile, loadService, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveFile = async () => {
    setSaving(true);
    try {
      await api("/api/v1/mosdns/config/file", {
        method: "PUT",
        body: JSON.stringify({ path: selectedPath, content }),
      });
      showToast("配置已保存");
      await loadService();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const downloadConfig = () => {
    const token = getToken();
    window.location.href = `/api/v1/mosdns/config/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  };

  const uploadConfig = async (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      await api("/api/v1/mosdns/config/upload", { method: "POST", body: form });
      showToast("配置已上传");
      await loadAll();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "配置上传失败");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const runServiceAction = async (action: "start" | "stop" | "restart") => {
    setServiceBusy(true);
    try {
      await api(`/api/v1/services/mosdns/${action}?wait=1&timeout=5`, { method: "POST" });
      showToast(action === "start" ? "MosDNS 已启动" : action === "stop" ? "MosDNS 已停止" : "MosDNS 已重启");
      await loadService();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "MosDNS 服务操作失败");
    } finally {
      setServiceBusy(false);
    }
  };

  const running = serviceRunning(service);
  const currentFileName = displayPath(selectedPath).split("/").pop() || "config.yaml";

  return (
    <AppShell>
      <div className="space-y-6 animate-fade-in">
        <MosdnsHero icon={Settings} title="配置管理" subtitle="管理 MosDNS 配置文件和版本" />
        <ServiceControlCard
          version={service?.version || "-"}
          cpuMem={`${formatPercent(service?.cpu_percent)} / ${formatBytes(service?.memory_bytes)}`}
          uptime={formatUptime(service?.uptime_seconds)}
          pid={service?.pid ? String(service.pid) : "-"}
          running={running}
          busy={serviceBusy}
          onAction={runServiceAction}
        />

        <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-muted/20 to-transparent">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">配置文件管理</h3>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCollapsed((value) => !value)} className={toolBtn}>
                <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
                {collapsed ? "展开" : "收起"}
              </button>
              <button onClick={downloadConfig} className={toolBtn}>
                <Download className="h-4 w-4" />下载
              </button>
              <button onClick={() => uploadRef.current?.click()} className={toolBtn}>
                <Upload className="h-4 w-4" />上传
              </button>
              <input ref={uploadRef} type="file" className="hidden" accept=".yaml,.yml,.zip,.tar,.gz" onChange={(event) => void uploadConfig(event.target.files?.[0])} />
            </div>
          </div>

          <div className="flex flex-col md:flex-row">
            {!collapsed && (
              <div className="md:w-56 flex-shrink-0 border-b md:border-b-0 md:border-r border-border/50 p-3 bg-gradient-to-b from-muted/40 to-muted/10">
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-primary">
                  <Folder className="h-4 w-4" />文件列表
                </div>
                {tree.length > 0 ? (
                  <FileTree
                    nodes={tree}
                    selectedPath={selectedPath}
                    onSelect={(node) => {
                      setSelectedPath(node.path);
                      void loadFile(node.path).catch((error) => showToast(error instanceof Error ? error.message : "文件读取失败"));
                    }}
                  />
                ) : (
                  <div className="px-2 py-3 text-xs text-muted-foreground">{loading ? "加载中..." : "没有配置文件"}</div>
                )}
              </div>
            )}

            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{currentFileName}</div>
                    <div className="text-xs text-muted-foreground truncate">{displayPath(selectedPath)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => showToast("后端暂未提供 MosDNS 配置校验接口")} className={toolBtn}>
                    <CircleCheckBig className="h-4 w-4" />验证
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving || !selectedPath}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <Save className={cn("h-4 w-4", saving && "animate-pulse")} />保存
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="flex h-[480px] items-center justify-center bg-[#1e1e1e] text-sm text-[#d4d4d4]">
                  正在加载配置...
                </div>
              ) : (
                <YamlEditor value={content} onChange={setContent} maxHeight={480} />
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 overflow-hidden">
            <div className="flex items-center justify-between p-6 bg-gradient-to-r from-muted/20 to-transparent border-b">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />内核版本
              </h3>
              <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium opacity-50">
                <Download className="h-4 w-4" />安装新版本
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">当前版本</span>
                <span className="font-mono font-medium text-foreground">{service?.version || "-"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">可用更新</span>
                <span className="font-medium text-foreground">-</span>
              </div>
            </div>
          </div>

          <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 overflow-hidden">
            <div className="flex items-center p-6 bg-gradient-to-r from-muted/20 to-transparent border-b">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />配置文件
              </h3>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">当前配置</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono font-medium text-foreground">{currentFileName || "-"}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" />使用中
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">路径</span>
                <span className="font-mono text-xs text-muted-foreground">{displayPath(selectedPath)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">文件数</span>
                <span className="font-mono text-xs text-muted-foreground">{files.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
