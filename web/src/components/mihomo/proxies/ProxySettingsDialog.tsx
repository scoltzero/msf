import { useEffect, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import type { ProxySettingsView } from "./types";
import { ProxyMoreSettingsDialog } from "./ProxyMoreSettingsDialog";

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

export function ProxySettingsDialog({
  open,
  settings,
  onChange,
  onClose,
  onReset,
  onMoreSettings,
}: {
  open: boolean;
  settings: ProxySettingsView;
  onChange: (value: ProxySettingsView) => void;
  onClose: () => void;
  onReset: () => void;
  /** Optional host hook; the local second-level dialog remains available when omitted. */
  onMoreSettings?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previous?.focus();
      setMoreSettingsOpen(false);
    };
  }, [open]);

  if (!open) return null;

  const patch = <K extends keyof ProxySettingsView>(key: K, value: ProxySettingsView[K]) =>
    onChange({ ...settings, [key]: value });

  const openMoreSettings = () => {
    onMoreSettings?.();
    setMoreSettingsOpen(true);
  };

  const minWidth = Number.isFinite(settings.minProxyCardWidth) ? settings.minProxyCardWidth : 145;

  return (
    <>
      <ModalViewport onClose={onClose} closeOnEscape={!moreSettingsOpen}>
        <GlassDialog
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden p-0"
          onClick={(event) => event.stopPropagation()}
          aria-labelledby="proxy-settings-title"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-border/45 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="proxy-settings-title" className="text-base font-semibold text-foreground">
                代理页面设置
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                常用显示和运行控制；Provider、策略组测速配置优先于页面兜底。
              </p>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-8 items-center gap-1 rounded-xl bg-background/45 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
              title="恢复页面设置默认值"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重置
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-background/45 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
              title="关闭代理页面设置"
              aria-label="关闭代理页面设置"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground/80">显示与筛选</h3>
              <div className="space-y-1 rounded-2xl bg-background/35 px-3 py-2">
                <SettingRow label="按供应商分组节点" description="展开策略组时按订阅供应商整理节点">
                  <Switch
                    checked={settings.groupProxiesByProvider}
                    onChange={(value) => patch("groupProxiesByProvider", value)}
                    label="按供应商分组节点"
                  />
                </SettingRow>
                <SettingRow label="隐藏不可用节点" description="过滤掉超时或没有有效延迟的节点">
                  <Switch
                    checked={settings.hideUnavailable}
                    onChange={(value) => patch("hideUnavailable", value)}
                    label="隐藏不可用节点"
                  />
                </SettingRow>
                <SettingRow label="管理用户隐藏策略组" description="显示策略组上的隐藏/显示管理入口">
                  <Switch
                    checked={settings.manageHiddenGroups}
                    onChange={(value) => patch("manageHiddenGroups", value)}
                    label="管理用户隐藏策略组"
                  />
                </SettingRow>
                <SettingRow label="显示配置隐藏项" description="配置中的 hidden 项仍优先，开启后额外显示">
                  <Switch
                    checked={settings.showHiddenProxies}
                    onChange={(value) => patch("showHiddenProxies", value)}
                    label="显示配置隐藏项"
                  />
                </SettingRow>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground/80">运行控制</h3>
              <div className="space-y-1 rounded-2xl bg-background/35 px-3 py-2">
                <SettingRow label="切换节点时自动断开受影响连接" description="只清理经过当前策略组的连接，不影响其他连接">
                  <Switch
                    checked={settings.autoDisconnectOnSwitch}
                    onChange={(value) => patch("autoDisconnectOnSwitch", value)}
                    label="切换节点时自动断开受影响连接"
                  />
                </SettingRow>
                <SettingRow label="显示最终出口节点" description="在当前策略组后显示解析出的物理出口节点">
                  <Switch
                    checked={settings.displayFinalOutbound}
                    onChange={(value) => patch("displayFinalOutbound", value)}
                    label="显示最终出口节点"
                  />
                </SettingRow>
                <SettingRow label="禁止代理页文字选中" description="适合拖动排序和触摸操作；不影响输入框">
                  <Switch
                    checked={settings.disableProxiesPageTextSelect}
                    onChange={(value) => patch("disableProxiesPageTextSelect", value)}
                    label="禁止代理页文字选中"
                  />
                </SettingRow>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground/80">节点卡片</h3>
              <div className="rounded-2xl bg-background/35 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-foreground">节点卡片最小宽度</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">控制展开策略组内节点卡片的自动换列宽度（px）</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <GlassField
                      type="number"
                      min={96}
                      max={640}
                      step={1}
                      value={minWidth}
                      aria-label="节点卡片最小宽度"
                      className="h-9 w-24 text-right tabular-nums"
                      onChange={(event) => patch("minProxyCardWidth", Number(event.target.value) || 145)}
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="border-t border-border/35 pt-4">
              <GlassButton
                type="button"
                variant="tool"
                className="h-10 w-full justify-center text-sm"
                onClick={openMoreSettings}
              >
                更多设置
              </GlassButton>
            </div>
          </div>
        </GlassDialog>
      </ModalViewport>

      <ProxyMoreSettingsDialog
        open={moreSettingsOpen}
        settings={settings}
        onChange={onChange}
        onClose={() => setMoreSettingsOpen(false)}
      />
    </>
  );
}
