import { useEffect, useMemo, useState } from "react";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { suggestedProxyProviderPath } from "@/features/mihomo-proxies/providerPath";
import { ProxyEditorShell } from "./ProxyEditorShell";

export interface ProxyProviderDraft {
  name: string;
  type: "http" | "file" | string;
  url: string;
  path: string;
  interval: number;
  healthCheckEnable: boolean;
  healthCheckUrl: string;
  healthCheckInterval: number;
  healthCheckLazy: boolean;
  advanced: string;
}

const EMPTY: ProxyProviderDraft = { name: "", type: "http", url: "", path: "", interval: 86400, healthCheckEnable: false, healthCheckUrl: "", healthCheckInterval: 300, healthCheckLazy: true, advanced: "{}" };

export function ProxyProviderEditorDialog({ open, value, onClose, onValidate, onSave }: { open: boolean; value?: Partial<ProxyProviderDraft> | null; onClose: () => void; onValidate: (draft: ProxyProviderDraft) => Promise<string | void> | string | void; onSave: (draft: ProxyProviderDraft) => Promise<void> | void }) {
  const [draft, setDraft] = useState<ProxyProviderDraft>(EMPTY);
  const [initial, setInitial] = useState(EMPTY);
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) { const next = { ...EMPTY, ...(value || {}) }; setDraft(next); setInitial(next); setMessage(""); } }, [open, value]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const suggestedPath = useMemo(() => suggestedProxyProviderPath(draft.name), [draft.name]);
  const patch = <K extends keyof ProxyProviderDraft>(key: K, value: ProxyProviderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const validate = async () => { setBusy("validate"); setMessage(""); try { if (draft.advanced.trim()) JSON.parse(draft.advanced); const result = await onValidate(draft); setMessage(result || "配置校验通过，可保存"); } catch (error) { setMessage(error instanceof SyntaxError ? `高级 JSON 格式错误：${error.message}` : error instanceof Error ? error.message : "配置校验失败，未写入"); } finally { setBusy(null); } };
  const save = async () => { setBusy("save"); setMessage(""); try { if (draft.advanced.trim()) JSON.parse(draft.advanced); await onSave(draft); setInitial(draft); } catch (error) { setMessage(error instanceof SyntaxError ? `高级 JSON 格式错误：${error.message}` : error instanceof Error ? error.message : "保存失败，未关闭编辑器"); } finally { setBusy(null); } };
  return <ProxyEditorShell open={open} title="编辑订阅供应商" description="保存 Provider 定义与在线更新/健康检查分离；未展示字段保存在高级配置。" dirty={dirty} saving={busy === "save"} validating={busy === "validate"} validationMessage={message} onClose={onClose} onValidate={() => void validate()} onSave={() => void save()}><div className="space-y-5"><section className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">名称<GlassField value={draft.name} onChange={(event) => patch("name", event.target.value)} className="mt-1 h-9 w-full" /></label><label className="text-xs text-muted-foreground">类型<select value={draft.type} onChange={(event) => patch("type", event.target.value)} className="mt-1 h-9 w-full rounded-xl bg-background/55 px-3 text-xs text-foreground outline-none"><option value="http">http</option><option value="file">file</option></select></label><label className="text-xs text-muted-foreground sm:col-span-2">订阅 URL<GlassField value={draft.url} onChange={(event) => patch("url", event.target.value)} placeholder="保存时不要求在线可下载" className="mt-1 h-9 w-full" /></label><label className="text-xs text-muted-foreground">本地路径<GlassField value={draft.path} onChange={(event) => patch("path", event.target.value)} placeholder={suggestedPath} className="mt-1 h-9 w-full" /><span className="mt-1.5 block text-[11px] leading-4 text-muted-foreground">留空时自动使用 <code className="font-mono text-foreground/80">{suggestedPath}</code>，也可以自定义相对路径。</span></label><label className="text-xs text-muted-foreground">更新间隔（秒）<GlassField type="number" min={0} value={draft.interval} onChange={(event) => patch("interval", Number(event.target.value) || 0)} className="mt-1 h-9 w-full" /></label></section><section className="space-y-3"><h3 className="text-xs font-semibold">健康检查</h3><div className="grid gap-3 rounded-2xl bg-background/35 p-3 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.healthCheckEnable} onChange={(event) => patch("healthCheckEnable", event.target.checked)} />启用健康检查</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.healthCheckLazy} onChange={(event) => patch("healthCheckLazy", event.target.checked)} />延迟执行（Lazy）</label><label className="text-xs text-muted-foreground sm:col-span-2">健康检查 URL<GlassField value={draft.healthCheckUrl} onChange={(event) => patch("healthCheckUrl", event.target.value)} className="mt-1 h-9 w-full" /></label><label className="text-xs text-muted-foreground">检查间隔（秒）<GlassField type="number" min={0} value={draft.healthCheckInterval} onChange={(event) => patch("healthCheckInterval", Number(event.target.value) || 0)} className="mt-1 h-9 w-full" /></label></div></section><label className="block text-xs text-muted-foreground">高级配置（JSON，保留 filter / exclude-filter / override 等字段）<textarea value={draft.advanced} onChange={(event) => patch("advanced", event.target.value)} className="mt-1 min-h-36 w-full rounded-2xl bg-background/50 px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30" spellCheck={false} /></label></div></ProxyEditorShell>;
}
