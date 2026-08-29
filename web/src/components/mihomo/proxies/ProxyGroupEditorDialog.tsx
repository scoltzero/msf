import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { api, apiData, formatBytes } from "@/lib/api";
import { ProxyEditorShell } from "./ProxyEditorShell";

export interface ProxyGroupDraftView {
  name: string;
  type: string;
  icon: string;
  proxies: string;
  url: string;
  interval: number;
  lazy: boolean;
  tolerance: number;
  strategy: string;
  policyPriority: string;
  uselightgbm: boolean;
  collectdata: boolean;
  sampleRate: number;
  preferAsn: boolean;
  advanced: string;
}
const EMPTY: ProxyGroupDraftView = {
  name: "",
  type: "select",
  icon: "",
  proxies: "",
  url: "",
  interval: 300,
  lazy: false,
  tolerance: 50,
  strategy: "consistent-hashing",
  policyPriority: "",
  uselightgbm: false,
  collectdata: false,
  sampleRate: 0,
  preferAsn: false,
  advanced: "{}",
};

export interface SmartResourceView {
  key: "lightgbm" | "asn";
  label: string;
  file_name: string;
  source_url: string;
  status: "idle" | "downloading" | "ready" | "failed";
  progress: number;
  message?: string;
  error?: string;
  size?: number;
  digest?: string;
  verified?: boolean;
}

function smartResourceMap(payload: unknown): Partial<Record<SmartResourceView["key"], SmartResourceView>> {
  const data = apiData<Record<string, unknown>>(payload, {});
  const resources = data && typeof data === "object" && data.resources && typeof data.resources === "object"
    ? data.resources as Record<string, SmartResourceView>
    : {};
  return {
    lightgbm: resources.lightgbm,
    asn: resources.asn,
  };
}

export function ProxyGroupEditorDialog({ open, readOnly = false, loading = false, value, onClose, onValidate, onSave }: { open: boolean; readOnly?: boolean; loading?: boolean; value?: Partial<ProxyGroupDraftView> | null; onClose: () => void; onValidate: (draft: ProxyGroupDraftView) => Promise<string | void> | string | void; onSave: (draft: ProxyGroupDraftView) => Promise<void> | void }) {
  const [draft, setDraft] = useState<ProxyGroupDraftView>(EMPTY);
  const [initial, setInitial] = useState(EMPTY);
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [message, setMessage] = useState("");
  const [smartResources, setSmartResources] = useState<Partial<Record<SmartResourceView["key"], SmartResourceView>>>({});
  useEffect(() => {
    if (open) {
      const next = { ...EMPTY, ...(value || {}) };
      setDraft(next);
      setInitial(next);
      setMessage("");
    }
  }, [open, value]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const patch = <K extends keyof ProxyGroupDraftView>(key: K, value: ProxyGroupDraftView[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const refreshSmartResources = useCallback(async () => {
    const payload = await api("/api/v1/mihomo/smart-resources");
    setSmartResources(smartResourceMap(payload));
  }, []);
  useEffect(() => {
    if (!open || draft.type !== "smart") return;
    let active = true;
    const refresh = async () => {
      try {
        const payload = await api("/api/v1/mihomo/smart-resources");
        const next = smartResourceMap(payload);
        if (active) setSmartResources(next);
        const pending: SmartResourceView["key"][] = [];
        if (draft.uselightgbm && next.lightgbm?.status === "idle") pending.push("lightgbm");
        if (draft.preferAsn && next.asn?.status === "idle") pending.push("asn");
        if (pending.length > 0) {
          await api("/api/v1/mihomo/smart-resources/download", {
            method: "POST",
            body: JSON.stringify({ resources: pending }),
          });
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "读取 Smart 资源状态失败");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [draft.preferAsn, draft.type, draft.uselightgbm, open]);

  const startSmartResourceDownload = async (key: SmartResourceView["key"]) => {
    if (smartResources[key]?.status === "ready" || smartResources[key]?.status === "downloading") return;
    setSmartResources((current) => ({
      ...current,
      [key]: {
        key,
        label: key === "lightgbm" ? "LightGBM 模型" : "ASN 数据库",
        file_name: key === "lightgbm" ? "Model.bin" : "ASN.mmdb",
        source_url: key === "lightgbm"
          ? "https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin"
          : "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
        status: "downloading",
        progress: 1,
        message: "正在启动下载",
      },
    }));
    try {
      await api("/api/v1/mihomo/smart-resources/download", {
        method: "POST",
        body: JSON.stringify({ resource: key }),
      });
      await refreshSmartResources();
    } catch (error) {
      setSmartResources((current) => ({
        ...current,
        [key]: {
          ...(current[key] as SmartResourceView),
          status: "failed",
          error: error instanceof Error ? error.message : "下载启动失败",
        },
      }));
    }
  };
  const validate = async () => {
    setBusy("validate");
    setMessage("");
    try {
      if (draft.advanced.trim()) JSON.parse(draft.advanced);
      setMessage((await onValidate(draft)) || "配置校验通过，可保存");
    } catch (error) {
      setMessage(error instanceof SyntaxError ? `高级 JSON 格式错误：${error.message}` : error instanceof Error ? error.message : "配置校验失败，未写入");
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    setMessage("");
    try {
      if (draft.advanced.trim()) JSON.parse(draft.advanced);
      await onSave(draft);
      setInitial(draft);
    } catch (error) {
      setMessage(error instanceof SyntaxError ? `高级 JSON 格式错误：${error.message}` : error instanceof Error ? error.message : "保存失败，未关闭编辑器");
    } finally {
      setBusy(null);
    }
  };
  const disabled = readOnly || loading;
  const healthChecked = ["url-test", "fallback", "load-balance"].includes(draft.type);
  const isSmart = draft.type === "smart";
  const resourceBlocked = isSmart && (
    (draft.uselightgbm && smartResources.lightgbm?.status !== "ready")
    || (draft.preferAsn && smartResources.asn?.status !== "ready")
  );
  const resourceStatus = (key: SmartResourceView["key"]) => {
    const resource = smartResources[key];
    if (!resource) {
      return <p className="mt-1 text-[11px] text-muted-foreground">正在读取资源状态…</p>;
    }
    return (
      <div className="mt-1.5 space-y-1.5 rounded-xl bg-background/45 px-2.5 py-2 text-[11px]" role="status" aria-live="polite">
        <div className="flex items-center gap-1.5">
          {resource.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : null}
          {resource.status === "downloading" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
          <span className="min-w-0 flex-1 text-muted-foreground">
            {resource.status === "ready"
              ? `已完成${resource.size ? ` · ${formatBytes(resource.size)}` : ""}`
              : resource.status === "failed"
                ? resource.error || "下载失败"
                : resource.message || "等待下载"}
          </span>
          <a href={resource.source_url} target="_blank" rel="noreferrer" className="shrink-0 text-primary hover:underline">官方来源</a>
          {resource.status === "failed" ? (
            <button type="button" onClick={() => void startSmartResourceDownload(key)} className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
              <RotateCw className="h-3 w-3" />重试
            </button>
          ) : null}
        </div>
        {resource.status === "downloading" ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${resource.label}下载进度 ${resource.progress}%`}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(1, Math.min(100, resource.progress || 0))}%` }} />
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <ProxyEditorShell
      open={open}
      title={readOnly ? "查看代理组" : "编辑代理组"}
      description={loading ? "正在读取静态配置…" : readOnly ? "默认配置的代理组由 MSF 管理，此处只读。" : "仅 custom 模式可保存代理组；未知字段继续原样保存。"}
      dirty={!disabled && dirty}
      saving={busy === "save"}
      validating={busy === "validate"}
      validationMessage={message}
      disabled={disabled}
      actionDisabled={resourceBlocked}
      onClose={onClose}
      onValidate={() => void validate()}
      onSave={() => void save()}
    >
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            名称
            <GlassField disabled={disabled} value={draft.name} onChange={(event) => patch("name", event.target.value)} className="mt-1 h-9 w-full" />
          </label>
          <label className="text-xs text-muted-foreground">
            类型
            <select disabled={disabled} value={draft.type} onChange={(event) => patch("type", event.target.value)} className="mt-1 h-9 w-full rounded-xl bg-background/55 px-3 text-xs text-foreground outline-none">
              <option value="select">select</option>
              <option value="url-test">url-test</option>
              <option value="fallback">fallback</option>
              <option value="load-balance">load-balance</option>
              <option value="relay">relay</option>
              <option value="smart">smart</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            策略组图标 URL（可选）
            <GlassField disabled={disabled} type="url" value={draft.icon} onChange={(event) => patch("icon", event.target.value)} placeholder="https://…/icon.svg" className="mt-1 h-9 w-full" />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            静态节点/策略组（每行一个）
            <textarea disabled={disabled} value={draft.proxies} onChange={(event) => patch("proxies", event.target.value)} placeholder="订阅节点请通过 use / include-all / filter 引入，不要填写运行时展开的节点名" className="mt-1 min-h-28 w-full rounded-2xl bg-background/50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/30" />
          </label>
          {healthChecked ? (
            <>
              <label className="text-xs text-muted-foreground">
                测速 URL
                <GlassField disabled={disabled} value={draft.url} onChange={(event) => patch("url", event.target.value)} className="mt-1 h-9 w-full" />
              </label>
              <label className="text-xs text-muted-foreground">
                间隔（秒）
                <GlassField disabled={disabled} type="number" min={0} value={draft.interval} onChange={(event) => patch("interval", Number(event.target.value) || 0)} className="mt-1 h-9 w-full" />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input disabled={disabled} type="checkbox" checked={draft.lazy} onChange={(event) => patch("lazy", event.target.checked)} />
                Lazy 延迟测速
              </label>
            </>
          ) : null}
          {draft.type === "url-test" ? (
            <label className="text-xs text-muted-foreground">
              容差（ms）
              <GlassField disabled={disabled} type="number" min={0} value={draft.tolerance} onChange={(event) => patch("tolerance", Number(event.target.value) || 0)} className="mt-1 h-9 w-full" />
            </label>
          ) : null}
          {draft.type === "load-balance" ? (
            <label className="text-xs text-muted-foreground">
              策略
              <GlassField disabled={disabled} value={draft.strategy} onChange={(event) => patch("strategy", event.target.value)} className="mt-1 h-9 w-full" />
            </label>
          ) : null}
          {isSmart ? (
            <>
              <label className="text-xs text-muted-foreground">
                策略优先级
                <GlassField disabled={disabled} value={draft.policyPriority} onChange={(event) => patch("policyPriority", event.target.value)} placeholder="例如 HK:1.6;SG:1.5;JP:1.3" className="mt-1 h-9 w-full" />
                <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">按节点名称或正则设置权重系数，多个规则用分号分隔。</span>
              </label>
              <label className="text-xs text-muted-foreground">
                采样率（0~1）
                <GlassField disabled={disabled} type="number" min={0} max={1} step={0.01} value={draft.sampleRate} onChange={(event) => patch("sampleRate", Number(event.target.value) || 0)} className="mt-1 h-9 w-full" />
              </label>
              <div className="text-xs">
                <label className="flex items-center gap-2">
                  <input disabled={disabled} type="checkbox" checked={draft.uselightgbm} onChange={(event) => {
                    patch("uselightgbm", event.target.checked);
                    if (event.target.checked) void startSmartResourceDownload("lightgbm");
                  }} />
                  使用 LightGBM
                </label>
                {draft.uselightgbm ? resourceStatus("lightgbm") : null}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input disabled={disabled} type="checkbox" checked={draft.collectdata} onChange={(event) => patch("collectdata", event.target.checked)} />
                收集流量历史（collectdata）
              </label>
              <div className="text-xs">
                <label className="flex items-center gap-2">
                  <input disabled={disabled} type="checkbox" checked={draft.preferAsn} onChange={(event) => {
                    patch("preferAsn", event.target.checked);
                    if (event.target.checked) void startSmartResourceDownload("asn");
                  }} />
                  优先 ASN
                </label>
                {draft.preferAsn ? resourceStatus("asn") : null}
              </div>
            </>
          ) : null}
        </section>
        {isSmart && draft.collectdata ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="status" aria-live="polite">
            <p className="font-medium">隐私与磁盘占用提醒</p>
            <p className="mt-1 leading-relaxed">
              启用 collectdata 后，训练数据可能包含目标域名/IP/端口、节点与策略组信息，并占用磁盘空间。Smart 依赖流量历史，因此冷启动阶段的选择可能波动。
            </p>
          </div>
        ) : null}
        <label className="block text-xs text-muted-foreground">
          高级配置（JSON）
          <textarea disabled={disabled} value={draft.advanced} onChange={(event) => patch("advanced", event.target.value)} className="mt-1 min-h-36 w-full rounded-2xl bg-background/50 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/30" spellCheck={false} />
        </label>
      </div>
    </ProxyEditorShell>
  );
}
