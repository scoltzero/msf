"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileCode2, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ToastStack, useToaster } from "@/components/Toaster";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { createEmptyProviderDraft } from "@/components/mihomo/rules/RuleProviderEditor";
import { RuleConfigStatus } from "@/components/mihomo/rules/RuleConfigStatus";
import { RuleConfigValidationPanel } from "@/components/mihomo/rules/RuleConfigValidationPanel";
import { RulePageHeader } from "@/components/mihomo/rules/RulePageHeader";
import { RuleProviderEditor } from "@/components/mihomo/rules/RuleProviderEditor";
import { RuleProviderList } from "@/components/mihomo/rules/RuleProviderList";
import { RuleEmptyState } from "@/components/mihomo/rules/RuleEmptyState";
import { RuleTextEditor } from "@/components/mihomo/rules/RuleTextEditor";
import { RuleToolbar, type RulePageTab } from "@/components/mihomo/rules/RuleToolbar";
import { RuleYamlEditor } from "@/components/mihomo/rules/RuleYamlEditor";
import { RuntimeRuleList } from "@/components/mihomo/rules/RuntimeRuleList";
import { useRuleConfig } from "@/features/mihomo-rules/useRuleConfig";
import { useRuleRuntime } from "@/features/mihomo-rules/useRuleRuntime";
import { draftHasUnsafeStructuredYaml, serializeProviderDrafts, serializeRuleConfigYaml } from "@/features/mihomo-rules/configDraft";
import { selectFilteredRules, ruleStableKey } from "@/features/mihomo-rules/selectors";
import { readRuleSettings, writeRuleSettings, type RulePageSettings } from "@/features/mihomo-rules/settings";

type ProviderScrollTarget =
  | { id: number; kind: "existing"; name: string }
  | { id: number; kind: "new"; index: number };

export default function MihomoRulesPage() {
  const { toasts, showToast } = useToaster();
  const [settings, setSettings] = useState<RulePageSettings>(() => readRuleSettings());
  const [tab, setTab] = useState<RulePageTab>("rules");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(settings.expandedRuleIds));
  const searchRef = useRef<HTMLInputElement>(null);
  const providerEditorRefs = useRef(new Map<number, HTMLDivElement>());
  const providerScrollSequence = useRef(0);
  const [providerScrollTarget, setProviderScrollTarget] = useState<ProviderScrollTarget>();
  const [selectingTargetName, setSelectingTargetName] = useState<string>();
  const runtime = useRuleRuntime({ enabled: true, autoRefreshMs: settings.autoRefresh ? 30_000 : 0 });
  const config = useRuleConfig({ enabled: tab === "config" });
  const { store, loading, refreshing, error } = runtime;
  const { draft: configDraft, snapshot: configSnapshot, loading: configLoading, load: loadConfig, validating: configValidating, validation: configValidation, saving: configSaving } = config;
  const authority = configSnapshot?.authority ?? store.authority;
  const filtered = useMemo(() => selectFilteredRules(store, deferredQuery, settings.searchMode), [deferredQuery, settings.searchMode, store]);
  const editable = authority.mode === "custom" && authority.canEditRules && authority.canEditRuleProviders;

  useEffect(() => { writeRuleSettings(settings); }, [settings]);
  useEffect(() => { if (error) showToast(error); }, [error, showToast]);
  useEffect(() => {
    if (tab === "config" && !configSnapshot && !configLoading) void loadConfig().catch((reason) => showToast(reason instanceof Error ? reason.message : "加载规则配置失败"));
  }, [configLoading, configSnapshot, loadConfig, showToast, tab]);
  useEffect(() => {
    if (!providerScrollTarget || tab !== "config" || configLoading || configDraft.mode !== "structured") return;
    const index = providerScrollTarget.kind === "new"
      ? providerScrollTarget.index
      : configDraft.providers.findIndex((provider) => provider.name === providerScrollTarget.name);
    if (index < 0) {
      if (configSnapshot && providerScrollTarget.kind === "existing") {
        showToast(`当前配置中未找到 ${providerScrollTarget.name}`);
        setProviderScrollTarget(undefined);
      }
      return;
    }
    const element = providerEditorRefs.current.get(index);
    if (!element || typeof window === "undefined") return;
    const targetId = providerScrollTarget.id;
    const targetName = providerScrollTarget.kind === "existing" ? providerScrollTarget.name : undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        element.focus({ preventScroll: true });
        setProviderScrollTarget((current) => current?.id === targetId ? undefined : current);
        showToast(targetName ? `已定位到 ${targetName} 的配置` : "已定位到新增规则提供商");
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [configDraft.mode, configDraft.providers, configLoading, configSnapshot, providerScrollTarget, showToast, tab]);

  const changeTab = (next: RulePageTab) => {
    if (tab === "config" && configDraft.dirty && next !== "config") {
      if (typeof window !== "undefined" && !window.confirm("配置草稿尚未保存，离开后会丢失修改。确定离开吗？")) return;
    }
    setTab(next);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSettings((value) => ({ ...value, expandedRuleIds: Array.from(next) }));
      return next;
    });
  };

  const toggleRule = async (rule: (typeof store.rules)[number], disabled: boolean) => {
    try {
      const result = await runtime.toggleRule(rule.id, disabled, settings.disconnectMatchedOnDisable && disabled);
      const closed = result.disconnect?.closed ?? 0;
      const failed = result.disconnect?.failedIds.length ?? 0;
      showToast(disabled ? `规则已禁用${closed ? `，已关闭 ${closed} 条匹配连接` : ""}${failed ? `，${failed} 条关闭失败` : ""}` : "规则已启用");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "规则状态更新失败");
    }
  };

  const updateProvider = async (name: string) => {
    try {
      await runtime.updateProvider(name);
      showToast(`${name} 已更新`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "更新失败，正在使用旧缓存");
    }
  };

  const editProvider = (name: string) => {
    providerScrollSequence.current += 1;
    setProviderScrollTarget({ id: providerScrollSequence.current, kind: "existing", name });
    setTab("config");
  };

  const addProvider = () => {
    providerScrollSequence.current += 1;
    setProviderScrollTarget({ id: providerScrollSequence.current, kind: "new", index: configDraft.providers.length });
    config.setDraft((draft) => ({ ...draft, providers: [...draft.providers, createEmptyProviderDraft()], dirty: true }));
  };

  const selectTargetNode = async (groupName: string, nodeName: string) => {
    setSelectingTargetName(groupName);
    try {
      await runtime.selectProxy(groupName, nodeName);
      showToast(`${groupName} 已切换到 ${nodeName}`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "切换节点失败");
    } finally {
      setSelectingTargetName(undefined);
    }
  };

  const updateConfigRules = (rulesText: string) => config.setDraft((draft) => ({ ...draft, rulesText, dirty: true }));
  const updateConfigYaml = (yamlText: string) => config.setDraft((draft) => ({ ...draft, yamlText, mode: "yaml", dirty: true }));
  const setStructuredMode = () => {
    const text = configDraft.yamlText?.trim();
    config.setDraft((draft) => ({ ...draft, mode: "structured", dirty: true, yamlText: text || serializeRuleConfigYaml(draft.rulesText, serializeProviderDrafts(draft.providers)) }));
  };

  const validateConfig = async () => {
    try {
      const result = await config.validate();
      showToast(result.valid ? "配置校验通过，可保存" : "配置校验失败，未写入");
    } catch (reason) { showToast(reason instanceof Error ? reason.message : "配置校验失败，未写入"); }
  };

  const saveConfig = async () => {
    if (!editable) { showToast("默认配置只读；请在配置管理中应用自定义配置后再编辑"); return; }
    try {
      await config.save();
      showToast("已保存并生效");
      await runtime.refresh({ silent: true });
    } catch (reason) { showToast(reason instanceof Error ? reason.message : "保存失败，未写入"); }
  };

  const structuredUnsafe = configDraft.mode === "structured" && draftHasUnsafeStructuredYaml(configDraft);
  const canSaveStructured = editable && !structuredUnsafe && !configSaving;

  return (
    <AppShell>
      <div className="space-y-3 md:space-y-4">
        <RulePageHeader ruleCount={store.rules.length} providerCount={store.providerNames.length} authority={authority} fetchedAt={store.fetchedAt} loading={loading} refreshing={refreshing} onRefresh={() => void runtime.refresh()} />
        <RuleToolbar tab={tab} onTabChange={changeTab} ruleCount={store.rules.length} providerCount={store.providerNames.length} query={query} onQueryChange={setQuery} searchMode={settings.searchMode} onSearchModeChange={(mode) => setSettings((value) => ({ ...value, searchMode: mode }))} regexError={filtered.error} onFocusSearch={() => searchRef.current?.focus()} searchInputRef={searchRef} />

        {tab === "rules" ? (
          <GlassSurface material="regular" className="p-2 md:p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
              <span>{filtered.rules.length === store.rules.length ? "按 Controller 原始顺序" : `筛选后 ${filtered.rules.length} 条，序号保持原始位置`}</span>
              {store.capabilities.ruleToggle ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">可切换运行状态</span> : <span className="rounded-full bg-muted px-2 py-0.5">当前内核不支持规则切换</span>}
              <label className="ml-auto inline-flex items-center gap-1.5"><input type="checkbox" checked={settings.disconnectMatchedOnDisable} onChange={(event) => { const checked = event.currentTarget.checked; setSettings((value) => ({ ...value, disconnectMatchedOnDisable: checked })); }} className="accent-primary" />禁用后断开精确匹配连接</label>
            </div>
            <RuntimeRuleList rules={filtered.rules} store={store} matcher={filtered.matcher} loading={loading} expandedIds={expandedIds} onExpand={toggleExpanded} onToggle={toggleRule} disconnectMatched={settings.disconnectMatchedOnDisable} selectingTargetName={selectingTargetName} onSelectTarget={(groupName, nodeName) => void selectTargetNode(groupName, nodeName)} />
          </GlassSurface>
        ) : tab === "providers" ? (
          <RuleProviderList store={store} query={deferredQuery} loading={loading} onUpdate={(name) => void updateProvider(name)} onEdit={editProvider} />
        ) : (
          <div className="space-y-3">
            <RuleConfigStatus authority={authority} dirty={configDraft.dirty} />
            {configLoading ? <RuleEmptyState loading title="正在加载配置草稿" /> : null}
            {!configLoading ? (
              <GlassSurface material="thick" className="space-y-4 p-4 md:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><FileCode2 className="h-4 w-4 text-primary" aria-hidden="true" />规则配置</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">规则一行一条，保存只移除真正的空行；规则提供商结构化编辑会深度合并并保留未知字段。</p></div>
                  <div className="flex items-center gap-2"><GlassButton type="button" variant={configDraft.mode === "structured" ? "primary" : "tool"} onClick={setStructuredMode} disabled={!editable}>结构化</GlassButton><GlassButton type="button" variant={configDraft.mode === "yaml" ? "primary" : "tool"} onClick={() => config.setDraft((draft) => ({ ...draft, mode: "yaml", yamlText: draft.yamlText || serializeRuleConfigYaml(draft.rulesText, serializeProviderDrafts(draft.providers)), dirty: true }))}>YAML 高级</GlassButton></div>
                </div>
                {configDraft.mode === "yaml" ? <RuleYamlEditor value={configDraft.yamlText || ""} onChange={updateConfigYaml} readOnly={!editable} /> : (
                  <>
                    <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-foreground">规则（多行文本）</h3><span className="text-xs text-muted-foreground">顺序即匹配顺序</span></div><RuleTextEditor value={configDraft.rulesText} onChange={updateConfigRules} issues={configValidation?.issues.filter((issue) => !issue.path || issue.path.startsWith("rules"))} readOnly={!editable} /></div>
                    <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-foreground">规则提供商配置</h3><GlassButton type="button" variant="tool" onClick={addProvider} disabled={!editable}>新增规则提供商</GlassButton></div><div className="space-y-2">{configDraft.providers.map((provider, index) => <div key={`${provider.name}-${index}`} ref={(element) => { if (element) providerEditorRefs.current.set(index, element); else providerEditorRefs.current.delete(index); }} tabIndex={-1} aria-label={`规则提供商配置 ${provider.name || "未命名"}`} className="min-w-0 scroll-mt-24 rounded-[var(--gary-radius-regular)] outline-none focus:ring-2 focus:ring-primary/60 focus:ring-offset-2 focus:ring-offset-background"><RuleProviderEditor draft={provider} onChange={(next) => config.setDraft((draft) => ({ ...draft, providers: draft.providers.map((item, itemIndex) => itemIndex === index ? next : item), dirty: true }))} onDelete={() => config.setDraft((draft) => ({ ...draft, providers: draft.providers.filter((_, itemIndex) => itemIndex !== index), dirty: true }))} /></div>)}</div>{configDraft.providers.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">暂无规则提供商。运行态仍可从 Controller 查看。</p> : null}</div>
                  </>
                )}
                {structuredUnsafe ? <p className="flex items-start gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />该区域包含 YAML 锚点或别名，请使用 YAML 编辑模式。</p> : null}
                <RuleConfigValidationPanel result={configValidation} validating={configValidating} />
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-3"><GlassButton type="button" variant="tool" onClick={() => config.discard()} disabled={!configDraft.dirty}>重新加载</GlassButton><GlassButton type="button" variant="tool" onClick={() => void validateConfig()} disabled={configValidating}><ShieldCheck className="h-4 w-4" aria-hidden="true" />校验配置</GlassButton><GlassButton type="button" variant="primary" onClick={() => void saveConfig()} disabled={(!canSaveStructured && configDraft.mode === "structured") || !editable || configSaving}><Save className="h-4 w-4" aria-hidden="true" />{configSaving ? "保存中" : "保存并重启"}</GlassButton></div>
              </GlassSurface>
            ) : null}
          </div>
        )}
      </div>
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
