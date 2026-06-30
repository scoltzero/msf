"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Folder, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { YamlEditor } from "@/components/mihomo/YamlEditor";
import { ToastStack, useToaster } from "@/components/Toaster";
import { api, apiList } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FileNode {
  name?: string;
  path?: string;
  type?: "file" | "dir" | "directory";
  children?: FileNode[];
}

const MIHOMO_RUNTIME_CONFIG = "configs/mihomo/config.yaml";
const DEFAULT_SELECTED = "configs/app.yaml";

function flatten(nodes: FileNode[], depth = 0): Array<FileNode & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flatten(node.children || [], depth + 1),
  ]);
}

export default function ConfigPage() {
  const { toasts, showToast } = useToaster();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState("");

  const files = useMemo(
    () => flatten(tree).filter((node) => {
      const path = node.path || node.name || "";
      return path !== MIHOMO_RUNTIME_CONFIG && ((node.type || "file") === "file" || !node.children?.length);
    }),
    [tree]
  );

  const loadTree = async () => {
    try {
      const payload = await api<any>("/api/v1/config/tree?path=configs");
      setTree(apiList<FileNode>(payload, ["tree", "data"]));
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
    if (selected === MIHOMO_RUNTIME_CONFIG) {
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
    <AppShell>
      <div className="space-y-5 animate-fade-in">
        <ToastStack toasts={toasts} />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-[10px] bg-gradient-to-br from-primary/10 to-secondary/10 p-2">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-none text-foreground">配置管理</h1>
              <p className="mt-1 text-sm text-muted-foreground">读取、验证并保存系统配置文件</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void loadFile(selected)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
            <button onClick={() => void validate()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <ShieldCheck className="h-4 w-4" />
              验证
            </button>
            <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              <Save className="h-4 w-4" />
              保存
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3 font-semibold">文件列表</div>
            <div className="max-h-[calc(100vh-220px)] overflow-auto p-2">
              {files.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">暂无配置文件</div>
              ) : (
                files.map((file) => {
                  const path = file.path || file.name || "";
                  return (
                    <button
                      key={path}
                      onClick={() => void loadFile(path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted",
                        selected === path && "bg-primary/10 text-primary"
                      )}
                      style={{ paddingLeft: `${8 + file.depth * 12}px` }}
                    >
                      <Folder className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="truncate">{file.name || path}</span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{selected}</div>
                <div className="text-xs text-muted-foreground">{content.length} 字符</div>
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
              maxHeight="calc(100vh - 260px)"
              className={cn("min-h-[calc(100vh-260px)]", loading && "opacity-70")}
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
