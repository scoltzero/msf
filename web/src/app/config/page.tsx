"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronsUpDown, FileText, LockKeyhole, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfigFileTree, collectConfigDirectoryPaths, countConfigFiles, type ConfigFileNode } from "@/components/config/ConfigFileTree";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { YamlEditor } from "@/components/mihomo/YamlEditor";
import { ToastStack, useToaster } from "@/components/Toaster";
import { api, apiList } from "@/lib/api";
import { cn } from "@/lib/utils";

const MIHOMO_RUNTIME_CONFIG = "configs/mihomo/config.yaml";
const DEFAULT_SELECTED = "configs/app.yaml";
const READ_ONLY_CONFIG_PATHS = new Set([MIHOMO_RUNTIME_CONFIG]);

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

export default function ConfigPage() {
  const { toasts, showToast } = useToaster();
  const [tree, setTree] = useState<ConfigFileNode[]>([]);
  const [treeRoot, setTreeRoot] = useState("configs");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState("");
  const [mobilePane, setMobilePane] = useState<"tree" | "editor">("tree");
  const treeInitialized = useRef(false);

  const directoryPaths = useMemo(() => collectConfigDirectoryPaths(tree), [tree]);
  const fileCount = useMemo(() => countConfigFiles(tree), [tree]);
  const allExpanded = directoryPaths.size > 0 && Array.from(directoryPaths).every((path) => expandedPaths.has(path));
  const readOnly = selected === MIHOMO_RUNTIME_CONFIG;

  const loadTree = async () => {
    try {
      const payload = await api<any>("/api/v1/config/tree?path=configs");
      const nextTree = apiList<ConfigFileNode>(payload, ["tree", "data"]);
      setTree(nextTree);
      setTreeRoot(String(payload.absolute_path || payload.root || "configs"));
      if (!treeInitialized.current) {
        setExpandedPaths(collectSelectedDirectoryPaths(nextTree, selected));
        treeInitialized.current = true;
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const loadFile = async (path = selected) => {
    setLoading(true);
    setValidation("");
    try {
      const payload = await api<any>(`/api/v1/config/file?path=${encodeURIComponent(path)}`);
      setSelected(payload.path || path);
      setContent(payload.content || "");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTree();
    void loadFile(selected);
  }, []);

  const save = async () => {
    if (readOnly) {
      showToast("运行配置不可在配置管理中直接保存");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/config/file", {
        method: "PUT",
        body: JSON.stringify({ path: selected, content, comment: "web ui save" }),
      });
      showToast("配置已保存");
      void loadTree();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    try {
      const payload = await api<any>("/api/v1/config/validate", {
        method: "POST",
        body: JSON.stringify({ path: selected, content }),
      });
      setValidation(payload.valid === false ? payload.error || "验证失败" : "配置验证通过");
    } catch (err) {
      setValidation(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AppShell fillViewport>
      <div className="flex h-full min-h-0 flex-col gap-4 animate-fade-in">
        <ToastStack toasts={toasts} />
        <div className="flex shrink-0 items-center gap-2.5 px-1">
          <div className="rounded-[12px] bg-primary/10 p-2.5 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-none text-foreground">配置管理</h1>
            <p className="mt-1 text-xs text-muted-foreground">读取、验证并保存系统配置文件</p>
          </div>
        </div>

        <GlassSurface material="thick" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px]">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground">配置工作区</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={selected}>{selected || "请选择配置文件"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <GlassButton type="button" variant="tool" onClick={() => void loadFile(selected)} className="h-8 px-2.5 text-xs">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </GlassButton>
            <GlassButton type="button" variant="secondary" onClick={() => void validate()} className="h-8 px-2.5 text-xs">
              <ShieldCheck className="h-4 w-4" />
              验证
            </GlassButton>
            <GlassButton type="button" variant="primary" onClick={() => void save()} disabled={saving || readOnly} title={readOnly ? "Mihomo 运行配置请在 Mihomo 配置页面修改" : "保存配置"} className="h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-60">
              <Save className="h-4 w-4" />
              保存
            </GlassButton>
          </div>
        </div>

          <div className="grid min-h-0 min-w-0 flex-1 items-stretch gap-3 p-3 md:grid-cols-[184px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className={cn("min-h-0 min-w-0", mobilePane === "tree" ? "block" : "hidden", "md:block")}>
            <SolidPlate tone="strong" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[16px]">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-semibold">配置目录</div>
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
              {tree.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">暂无配置文件</div>
              ) : (
                <ConfigFileTree
                  nodes={tree}
                  selectedPath={selected}
                  expandedPaths={expandedPaths}
                  onToggle={(path) => setExpandedPaths((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })}
                  onSelect={(node) => {
                    setMobilePane("editor");
                    void loadFile(node.path || node.name || "");
                  }}
                  readOnlyPaths={READ_ONLY_CONFIG_PATHS}
                />
              )}
            </div>
            </SolidPlate>
          </aside>

          <section className={cn("min-h-0 min-w-0 max-w-full", mobilePane === "editor" ? "block" : "hidden", "md:block")}>
            <SolidPlate tone="strong" className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[16px]">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobilePane("tree")}
                  className="gary-icon-button h-8 w-8 shrink-0 rounded-[9px] text-muted-foreground hover:text-foreground md:!hidden"
                  aria-label="返回配置目录"
                  title="返回配置目录"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5 font-semibold">
                    <span className="truncate">{selected}</span>
                    {readOnly ? <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="只读文件" /> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{content.length} 字符</div>
                </div>
              </div>
              {validation && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {validation}
                </div>
              )}
            </div>
            <YamlEditor
              value={content}
              onChange={setContent}
              readOnly={readOnly}
              maxHeight="100%"
              className={cn("min-h-0 flex-1", loading && "opacity-70")}
            />
            </SolidPlate>
          </section>
        </div>
        </GlassSurface>
      </div>
    </AppShell>
  );
}
