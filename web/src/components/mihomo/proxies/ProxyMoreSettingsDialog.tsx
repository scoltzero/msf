import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import type { ProxySettingsView } from "./types";

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border/45 transition-[background-color,box-shadow] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${checked ? "bg-primary/80 shadow-sm shadow-primary/20" : "bg-muted/70"}`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <GlassField
      type="number"
      min={min}
      max={max}
      step={1}
      value={Number.isFinite(value) ? value : min}
      aria-label={label}
      className="h-9 w-24 text-right tabular-nums"
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
      }}
    />
  );
}

export function ProxyMoreSettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: ProxySettingsView;
  onChange: (value: ProxySettingsView) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState(settings.delayTestUrl);
  const [overrideUrl, setOverrideUrl] = useState(settings.delayTestOverrideUrl);
  const [overrideEnabled, setOverrideEnabled] = useState(settings.delayTestOverrideEnabled);
  const [policyMessage, setPolicyMessage] = useState("");

  useEffect(() => {
    setFallbackUrl(settings.delayTestUrl);
    setOverrideUrl(settings.delayTestOverrideUrl);
    setOverrideEnabled(settings.delayTestOverrideEnabled);
  }, [open, settings.delayTestUrl, settings.delayTestOverrideUrl, settings.delayTestOverrideEnabled]);

  const applyTestPolicy = () => {
    const valid = (value: string) => {
      try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
      catch { return false; }
    };
    if (!valid(fallbackUrl.trim()) || (overrideUrl.trim() && !valid(overrideUrl.trim())) || (overrideEnabled && !valid(overrideUrl.trim()))) {
      setPolicyMessage("请填写有效的 HTTP(S) 测速网址");
      return;
    }
    onChange({ ...settings, delayTestUrl: fallbackUrl.trim(), delayTestOverrideUrl: overrideUrl.trim(), delayTestOverrideEnabled: overrideEnabled });
    setPolicyMessage("已提交测速设置；保存或生效失败时页面会提示并恢复");
  };

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  const patch = <K extends keyof ProxySettingsView>(key: K, value: ProxySettingsView[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <ModalViewport onClose={onClose}>
      <GlassDialog
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
        aria-labelledby="proxy-more-settings-title"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border/45 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="proxy-more-settings-title" className="text-base font-semibold text-foreground">
              代理页面更多设置
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              外观与测速设置。策略组单独设置优先，其次是全局覆盖、Provider 配置和兜底。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-background/45 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            title="关闭更多设置"
            aria-label="关闭更多设置"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground/80">外观</h3>
            <div className="space-y-1 rounded-2xl bg-background/35 px-3 py-2">
              <SettingRow label="双列显示策略组" description="桌面宽度足够时使用两列独立瀑布布局">
                <Switch
                  checked={settings.doubleColumn}
                  onChange={(value) => patch("doubleColumn", value)}
                  label="双列显示策略组"
                />
              </SettingRow>
              <SettingRow label="根据模式显示 GLOBAL" description="仅 Mihomo 当前模式为 Global 时显示 GLOBAL 链路">
                <Switch
                  checked={settings.displayGlobalByMode}
                  onChange={(value) => patch("displayGlobalByMode", value)}
                  label="根据模式显示 GLOBAL"
                />
              </SettingRow>
              <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm">
                <div>
                  <div className="font-medium text-foreground">节点名称</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">长名称可截断，也可换行完整查看</p>
                </div>
                <div className="flex rounded-xl bg-background/45 p-1" role="group" aria-label="节点名称显示方式">
                  {(["truncate", "wrap"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={settings.nodeNameDisplay === value}
                      onClick={() => patch("nodeNameDisplay", value)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${settings.nodeNameDisplay === value ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {value === "truncate" ? "截断" : "换行"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm">
                <div>
                  <div className="font-medium text-foreground">节点预览类型</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">点显示节点状态，条显示整体状态，自动按宽度选择</p>
                </div>
                <select
                  value={settings.proxyPreviewType}
                  onChange={(event) => patch("proxyPreviewType", event.target.value as ProxySettingsView["proxyPreviewType"])}
                  aria-label="节点预览类型"
                  className="h-9 min-w-24 rounded-xl border border-border/45 bg-background/45 px-3 text-xs text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/45 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="auto">自动</option>
                  <option value="dots">点</option>
                  <option value="bar">条</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm">
                <div>
                  <div className="font-medium text-foreground">节点卡片尺寸</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">紧凑节省空间，舒适模式更易阅读</p>
                </div>
                <select
                  value={settings.proxyCardSize}
                  onChange={(event) => patch("proxyCardSize", event.target.value as ProxySettingsView["proxyCardSize"])}
                  aria-label="节点卡片尺寸"
                  className="h-9 min-w-24 rounded-xl border border-border/45 bg-background/45 px-3 text-xs text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/45 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="compact">紧凑</option>
                  <option value="comfortable">舒适</option>
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground/80">策略组图标</h3>
            <div className="grid gap-3 rounded-2xl bg-background/35 px-3 py-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                图标尺寸（px）
                <NumberField
                  value={settings.proxyGroupIconSize}
                  min={12}
                  max={64}
                  label="策略组图标尺寸"
                  onChange={(value) => patch("proxyGroupIconSize", value)}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                图标间距（px）
                <NumberField
                  value={settings.proxyGroupIconMargin}
                  min={0}
                  max={32}
                  label="策略组图标间距"
                  onChange={(value) => patch("proxyGroupIconMargin", value)}
                />
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground/80">测速设置</h3>
            <div className="grid gap-3 rounded-2xl bg-background/35 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="min-w-0 text-xs text-muted-foreground">
                默认测速 URL（仅兜底）
                <GlassField
                  type="url"
                  value={fallbackUrl}
                  aria-label="默认测速 URL"
                  onChange={(event) => setFallbackUrl(event.target.value)}
                  className="mt-1 h-9 w-full"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                timeoutMs
                <NumberField
                  value={settings.delayTimeoutMs}
                  min={1_000}
                  max={120_000}
                  label="测速 timeoutMs"
                  onChange={(value) => patch("delayTimeoutMs", value)}
                />
              </label>
            </div>
            <p className="px-1 text-[11px] leading-5 text-muted-foreground">
              仅在没有可用配置时使用兜底网址。测速失败会直接报告，不会自动换网址重试。
            </p>
            <SettingRow label="全局覆盖测速 URL" description="作用于手动测速和后台健康检查；策略组单独设置仍优先。关闭后恢复原配置。">
              <Switch checked={overrideEnabled} onChange={setOverrideEnabled} label="全局覆盖测速 URL" />
            </SettingRow>
            <label className="block text-xs text-muted-foreground">
              全局覆盖网址
              <GlassField type="url" value={overrideUrl} aria-label="全局覆盖网址" placeholder="https://example.com/generate_204" onChange={(event) => setOverrideUrl(event.target.value)} className="mt-1 h-9 w-full" />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">应用后，运行中的 Mihomo 会在需要时重启；原配置中的网址、健康检查开关和周期都会保留。</p>
            <GlassButton type="button" onClick={applyTestPolicy} className="h-9 px-4 text-xs">应用测速设置</GlassButton>
            {policyMessage ? <p role="status" className="text-xs leading-5 text-foreground">{policyMessage}</p> : null}
          </section>

          <footer className="flex justify-end border-t border-border/35 pt-4">
            <GlassButton type="button" onClick={onClose} className="h-9 px-4 text-xs">
              完成
            </GlassButton>
          </footer>
        </div>
      </GlassDialog>
    </ModalViewport>
  );
}
