"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings,
  ArrowLeft,
  FileText,
  FileCode,
  ChevronLeft,
  ChevronsUpDown,
  Download,
  Upload,
  CircleCheckBig,
  Save,
  RotateCw,
  Play,
  Square,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfigFileTree, collectConfigDirectoryPaths, countConfigFiles, flattenConfigFiles, type ConfigFileNode } from "@/components/config/ConfigFileTree";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { YamlEditor } from "@/components/mihomo/YamlEditor";
import { useToaster, ToastStack } from "@/components/Toaster";
import { api, apiData, apiList, formatBytes, formatPercent, getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

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

function collectSelectedDirectoryPaths(nodes: ConfigFileNode[], selectedPath: string) {
  const paths = new Set<string>();
  const visit = (items: ConfigFileNode[]): boolean => items.some((node) => {
    const path = node.path || node.name || "";
    const children = node.children || [];
    if (children.length === 0) return path === selectedPath;
    const descendantContainsSelected = visit(children);
    const containsSelected = path === selectedPath || descendantContainsSelected || selectedPath.startsWith(`${path}/`);
    if (containsSelected && path) paths.add(path);
    return containsSelected;
  });
  visit(nodes);
  return paths;
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

export default function ServiceConfigPage() {
  const [collapsed, setCollapsed] = useState(false);
  const [tree, setTree] = useState<ConfigFileNode[]>([]);
  const [treeRoot, setTreeRoot] = useState("configs/mosdns");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mobilePane, setMobilePane] = useState<"tree" | "editor">("tree");
  const [service, setService] = useState<ServiceInfo | undefined>();
  const [serviceBusy, setServiceBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const treeInitialized = useRef(false);
  const { toasts, showToast } = useToaster();

  const fileCount = useMemo(() => countConfigFiles(tree), [tree]);
  const directoryPaths = useMemo(() => collectConfigDirectoryPaths(tree), [tree]);
  const allExpanded = directoryPaths.size > 0 && Array.from(directoryPaths).every((path) => expandedPaths.has(path));

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
      const data = apiData<ConfigFileNode[] | ConfigFileNode>(treePayload, treePayload as ConfigFileNode[] | ConfigFileNode);
      const nodes = Array.isArray(data) ? data : data?.children || [];
      setTree(nodes);
      setTreeRoot(String((treePayload as any)?.absolute_path || (treePayload as any)?.root || "configs/mosdns"));
      const flatFiles = flattenConfigFiles(nodes);
      const firstConfig = flatFiles.find((file) => file.name === "config.yaml") || flatFiles.find((file) => file.name?.endsWith(".yaml") || file.name?.endsWith(".yml"));
      if (!treeInitialized.current) {
        setExpandedPaths(collectSelectedDirectoryPaths(nodes, firstConfig?.path || "config.yaml"));
        treeInitialized.current = true;
      }
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
    <AppShell fillViewport>
      <div className="flex h-full min-h-0 flex-col gap-3 animate-fade-in">
        <WorkbenchHeader
          icon={Settings}
          title="MosDNS 配置管理"
          description="配置文件、运行状态与服务控制"
          status={(
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              running ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground",
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-green-500 animate-pulse" : "bg-muted-foreground")} />
              {running ? "运行中" : "已停止"}
            </span>
          )}
          actions={(
            <>
              <button
                type="button"
                onClick={() => void runServiceAction("restart")}
                disabled={serviceBusy}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                <RotateCw className={cn("h-3.5 w-3.5", serviceBusy && "animate-spin")} />
                重启
              </button>
              <button
                type="button"
                onClick={() => void runServiceAction(running ? "stop" : "start")}
                disabled={serviceBusy}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "停止" : "启动"}
              </button>
            </>
          )}
          summary={(
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
              <div><span className="text-muted-foreground">版本</span><div className="truncate font-semibold text-foreground" title={service?.version || "-"}>{service?.version || "-"}</div></div>
              <div className="hidden sm:block"><span className="text-muted-foreground">CPU / 内存</span><div className="font-semibold text-foreground">{formatPercent(service?.cpu_percent)} / {formatBytes(service?.memory_bytes)}</div></div>
              <div className="hidden sm:block"><span className="text-muted-foreground">运行时间</span><div className="font-semibold text-foreground">{formatUptime(service?.uptime_seconds)}</div></div>
              <div className="hidden sm:block"><span className="text-muted-foreground">PID</span><div className="font-semibold text-foreground">{service?.pid ? String(service.pid) : "-"}</div></div>
              <div className="min-w-0"><span className="text-muted-foreground">当前配置</span><div className="truncate font-mono font-semibold text-foreground" title={currentFileName}>{currentFileName}</div></div>
            </div>
          )}
        />

        <GlassSurface material="thick" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px]">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">配置文件管理</h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={selectedPath}>{displayPath(selectedPath)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <GlassButton onClick={() => setCollapsed((value) => !value)} variant="tool" className="hidden h-8 px-2.5 text-xs md:inline-flex">
                <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
                {collapsed ? "展开" : "收起"}
              </GlassButton>
              <GlassButton onClick={downloadConfig} variant="tool" className="h-8 px-2.5 text-xs">
                <Download className="h-4 w-4" />下载
              </GlassButton>
              <GlassButton onClick={() => uploadRef.current?.click()} variant="secondary" className="h-8 px-2.5 text-xs">
                <Upload className="h-4 w-4" />上传
              </GlassButton>
              <GlassButton onClick={() => showToast("后端暂未提供 MosDNS 配置校验接口")} variant="secondary" className="h-8 px-2.5 text-xs">
                <CircleCheckBig className="h-4 w-4" />验证
              </GlassButton>
              <GlassButton
                onClick={saveFile}
                disabled={saving || !selectedPath}
                variant="primary"
                className="h-8 px-2.5 text-xs"
              >
                <Save className={cn("h-4 w-4", saving && "animate-pulse")} />保存
              </GlassButton>
              <input ref={uploadRef} type="file" className="hidden" accept=".yaml,.yml,.zip,.tar,.gz" onChange={(event) => void uploadConfig(event.target.files?.[0])} />
            </div>
          </div>

          <div className={cn("grid min-h-0 min-w-0 flex-1 items-stretch gap-3 p-3", collapsed ? "md:grid-cols-1" : "md:grid-cols-[184px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]")}>
            <aside className={cn("min-h-0 min-w-0", mobilePane === "tree" ? "block" : "hidden", "md:block", collapsed && "md:hidden")}>
              <SolidPlate tone="strong" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[16px]">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="font-semibold">MosDNS 配置目录</div>
                    <div className="truncate text-[11px] text-muted-foreground" title={treeRoot}>{treeRoot} · {fileCount} 个文件</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedPaths(allExpanded ? new Set() : new Set(directoryPaths))}
                    disabled={directoryPaths.size === 0}
                    className="gary-icon-button h-8 w-8 shrink-0 rounded-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    aria-label={allExpanded ? "收起全部目录" : "展开全部目录"}
                    title={allExpanded ? "收起全部" : "展开全部"}
                  >
                    <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-2">
                  {tree.length > 0 ? (
                    <ConfigFileTree
                      nodes={tree}
                      selectedPath={selectedPath}
                      expandedPaths={expandedPaths}
                      onToggle={(path) => setExpandedPaths((current) => {
                        const next = new Set(current);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })}
                      onSelect={(node) => {
                        const path = node.path || node.name || "";
                        setSelectedPath(path);
                        setMobilePane("editor");
                        void loadFile(path).catch((error) => showToast(error instanceof Error ? error.message : "文件读取失败"));
                      }}
                    />
                  ) : (
                    <div className="px-2 py-3 text-xs text-muted-foreground">{loading ? "加载中..." : "没有配置文件"}</div>
                  )}
                </div>
              </SolidPlate>
            </aside>

            <section className={cn("min-h-0 min-w-0 max-w-full", mobilePane === "editor" ? "block" : "hidden", "md:block")}>
              <SolidPlate tone="strong" className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[16px]">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => setMobilePane("tree")}
                      className="gary-icon-button h-8 w-8 shrink-0 rounded-[9px] text-muted-foreground hover:text-foreground md:!hidden"
                      aria-label="返回 MosDNS 配置目录"
                      title="返回 MosDNS 配置目录"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <FileCode className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{currentFileName}</div>
                      <div className="text-xs text-muted-foreground truncate">{displayPath(selectedPath)}</div>
                    </div>
                  </div>
                </div>
                {loading ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center bg-[#1e1e1e] text-sm text-[#d4d4d4]">
                    正在加载配置...
                  </div>
                ) : (
                  <YamlEditor
                    value={content}
                    onChange={setContent}
                    maxHeight="100%"
                    className="min-h-0 flex-1"
                  />
                )}
              </SolidPlate>
            </section>
          </div>
        </GlassSurface>

      </div>
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
