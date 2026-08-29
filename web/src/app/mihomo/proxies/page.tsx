"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { useToaster, ToastStack } from "@/components/Toaster";
import { api, apiData, formatBytes } from "@/lib/api";
import { useProxyRuntime } from "@/features/mihomo-proxies/useProxyRuntime";
import { selectGroupNodes, selectVisibleGroups, searchProxyStore } from "@/features/mihomo-proxies/selectors";
import { parseProxyKey } from "@/features/mihomo-proxies/normalize";
import { mergeStableOrder } from "@/features/mihomo-proxies/ordering";
import { compileSafeSearch } from "@/features/mihomo-proxies/search";
import { useProxySettings } from "@/features/mihomo-proxies/useProxySettings";
import { useProxyDisclosure } from "@/features/mihomo-proxies/useProxyDisclosure";
import { useProxyGroupTraffic } from "@/features/mihomo-proxies/useProxyGroupTraffic";
import { buildProxyGroupRow, proxyGroupDraft, proxyGroupRows, replaceProxyGroup } from "@/features/mihomo-proxies/groupConfig";
import type { ProxyEntity, ProxyKey, ProxyPageSettings, ProxyProvider, ProxyStore } from "@/features/mihomo-proxies/types";
import { ProxyPageHeader } from "@/components/mihomo/proxies/ProxyPageHeader";
import { ProxyToolbar } from "@/components/mihomo/proxies/ProxyToolbar";
import { ProxyGroupList } from "@/components/mihomo/proxies/ProxyGroupList";
import { ProxyProviderList } from "@/components/mihomo/proxies/ProxyProviderList";
import { ProxyLatencyProgress } from "@/components/mihomo/proxies/ProxyLatencyProgress";
import { ProxyChainDialog } from "@/components/mihomo/proxies/ProxyChainDialog";
import { ProxySettingsDialog } from "@/components/mihomo/proxies/ProxySettingsDialog";
import { ProxyProviderEditorDialog, type ProxyProviderDraft } from "@/components/mihomo/proxies/ProxyProviderEditorDialog";
import { ProxyGroupEditorDialog, type ProxyGroupDraftView } from "@/components/mihomo/proxies/ProxyGroupEditorDialog";
import { ProxyManualNodeEditorDialog, type ProxyManualNodeDraft } from "@/components/mihomo/proxies/ProxyManualNodeEditorDialog";
import { ProxyCollectionManagerDialog, type ProxyCollectionItem } from "@/components/mihomo/proxies/ProxyCollectionManagerDialog";
import type { ProxyConfigStatusView, ProxyGroupView, ProxyNodeView, ProxyProviderView, ProxySearchMode, ProxySettingsView } from "@/components/mihomo/proxies/types";
import "./mihomo-proxies.css";

const PROXY_SCENE_PROFILE = "proxy-dense";

function useProxyScenePerformanceProfile() {
  useEffect(() => {
    const root = document.documentElement;
    const previousProfile = root.dataset.garySceneProfile;

    root.dataset.garySceneProfile = PROXY_SCENE_PROFILE;
    return () => {
      if (previousProfile) root.dataset.garySceneProfile = previousProfile;
      else delete root.dataset.garySceneProfile;
    };
  }, []);
}

function nodeView(entity: ProxyEntity, finalEntity?: ProxyEntity): ProxyNodeView { return { key: entity.key, name: entity.name, type: entity.type, kind: entity.kind, delay: finalEntity?.delay ?? entity.delay, alive: finalEntity?.alive ?? entity.alive, hidden: entity.hidden, icon: entity.icon, providerName: entity.providerName }; }
function providerView(store: ProxyStore, provider: ProxyProvider, keys: Set<ProxyKey>): ProxyProviderView { const nodes = provider.proxyKeys.map((key) => store.entities[key]).filter((entity): entity is ProxyEntity => Boolean(entity && keys.has(entity.key))).map((entity) => nodeView(entity)); const subscription = provider.subscription; const used = subscription?.used ?? provider.used ?? 0; const quota = subscription?.total ?? provider.quota ?? 0; return { id: provider.id, name: provider.name, vehicleType: provider.vehicleType, nodes, alive: provider.alive, total: provider.total ?? nodes.length, used: used ? formatBytes(used) : "-", quota: quota ? formatBytes(quota) : "-", percent: provider.percent ?? (quota ? (used / quota) * 100 : 0), updated: provider.updatedAt || "未更新", expire: subscription?.expire }; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function validationMessage(payload: unknown) { const row = asRecord(apiData(payload, payload)); if (row.success === false || row.valid === false) throw new Error(String(row.message || row.error || "配置校验失败，未写入")); return String(row.message || "配置校验通过，可保存"); }

export default function MihomoProxiesPage() {
  useProxyScenePerformanceProfile();
  const { toasts, showToast } = useToaster();
  const { settings, setSettings, resetSettings } = useProxySettings();
  const [search, setSearch] = useState(""); const [searchMode, setSearchMode] = useState<ProxySearchMode>("groups"); const [regex, setRegex] = useState(false); const deferredSearch = useDeferredValue(search); const [typeFilter, setTypeFilter] = useState("all"); const [autoRefresh, setAutoRefresh] = useState(true); const [reorderEnabled, setReorderEnabled] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [chainGroup, setChainGroup] = useState<ProxyGroupView | null>(null); const [editor, setEditor] = useState<"provider" | "group" | "manual" | null>(null); const [groupManagerOpen, setGroupManagerOpen] = useState(false); const [providerManagerOpen, setProviderManagerOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProxyProviderDraft>(); const [groupDraft, setGroupDraft] = useState<ProxyGroupDraftView>(); const [groupConfigLoading, setGroupConfigLoading] = useState(false); const [manualDraft, setManualDraft] = useState<ProxyManualNodeDraft>(); const [editorKey, setEditorKey] = useState(""); const [editorBusy, setEditorBusy] = useState<string | null>(null); const [testingTarget, setTestingTarget] = useState<string | null>(null); const [updatingProvider, setUpdatingProvider] = useState<string | null>(null);
  const runtime = useProxyRuntime({ enabled: true, autoRefreshMs: autoRefresh ? 30_000 : 0, pageFallback: { url: settings.delayTestUrl, timeoutMs: settings.delayTimeoutMs }, settings: { autoDisconnectOnSwitch: settings.autoDisconnectOnSwitch } }); const { store, loading, refreshing, error, testingJobs } = runtime; const resolveChain = runtime.resolveChain;
  const { groupTraffic } = useProxyGroupTraffic({ enabled: true, intervalMs: 2_000 });
  useEffect(() => { if (error) showToast(error); }, [error, showToast]);

  const baseGroups = useMemo(() => {
    const selectorSettings = settings.manageHiddenGroups ? { ...settings, hiddenGroups: [] } : settings;
    const matched = selectVisibleGroups(store, selectorSettings, searchMode === "groups" ? deferredSearch : "", { regex });
    const nodeKeys = searchMode === "nodes"
      ? new Set(searchProxyStore(store, deferredSearch, "nodes", { regex }).results.map((item) => item.key))
      : undefined;
    return matched.groups
      .filter((group) => !(settings.displayGlobalByMode && store.stats.mode.toLowerCase() !== "global" && group.name.trim().toUpperCase() === "GLOBAL"))
      .map((group) => {
        const groupKey = group.key as ProxyKey;
        const members = selectGroupNodes(store, groupKey, true).filter((node) => !nodeKeys || nodeKeys.has(node.key));
        const nodes = members.map((node) => {
          const nodeChain = node.kind === "group" ? resolveChain(node.key) : undefined;
          const nodeFinal = nodeChain?.finalKey ? store.entities[nodeChain.finalKey] : undefined;
          return nodeView(node, nodeFinal);
        });
        const chain = resolveChain(groupKey);
        const finalNode = chain.finalKey ? store.entities[chain.finalKey] : undefined;
        const selected = group.selectedKey ? store.entities[group.selectedKey] : undefined;
        return {
          key: groupKey,
          name: group.name,
          type: group.type,
          icon: group.icon,
          nodes,
          selectedKey: group.selectedKey,
          selectedName: selected?.name,
          selectedIcon: selected?.icon,
          finalOutboundKey: finalNode?.key,
          finalOutboundName: finalNode?.name,
          finalOutboundIcon: finalNode?.icon,
          finalOutboundProvider: finalNode?.providerName,
          delay: finalNode?.delay ?? group.delay,
          trafficSpeed: 0,
          hidden: group.hidden,
          userHidden: settings.hiddenGroups.includes(group.name),
          readOnly: !store.authority.canEditGroups,
        } satisfies ProxyGroupView;
      })
      .filter((group) => searchMode !== "nodes" || group.nodes.length > 0);
  }, [deferredSearch, regex, resolveChain, searchMode, settings, store]);
  const groups = useMemo(() => baseGroups.map((group) => {
    const trafficSpeed = groupTraffic[group.name]?.total ?? 0;
    return trafficSpeed === group.trafficSpeed ? group : { ...group, trafficSpeed };
  }), [baseGroups, groupTraffic]);
  const providers = useMemo(() => { const matcher = compileSafeSearch(deferredSearch, { regex }); const all = Object.values(store.providers); return all.map((provider) => { const keys = new Set(provider.proxyKeys.filter((key) => { const entity = store.entities[key]; return entity && (settings.showHiddenProxies || !entity.hidden) && matcher.valid && (!deferredSearch || matcher.test([entity.name, entity.type, entity.providerName].filter(Boolean).join(" "))); })); return providerView(store, provider, keys); }).filter((provider) => provider.nodes.length > 0 || !deferredSearch); }, [deferredSearch, regex, settings.showHiddenProxies, store]);
  const typeOptions = useMemo(() => ["all", ...Array.from(new Set(groups.map((group) => group.type).filter(Boolean)))], [groups]);
  const visibleGroups = useMemo(() => typeFilter === "all" ? groups : groups.filter((group) => group.type === typeFilter), [groups, typeFilter]);
  const disclosure = useProxyDisclosure({ groupKeys: visibleGroups.map((group) => group.key), providerKeys: providers.map((provider) => provider.id) });
  const { tab, setTab, collapsed, toggleCollapse, allCollapsed: allItemsCollapsed, setAllCollapsed } = disclosure;
  const currentDisclosureKind = tab === "groups" ? "group" : "provider";
  const currentDisclosureKeys = tab === "groups" ? visibleGroups.map((group) => group.key) : providers.map((provider) => provider.id);
  const allCollapsed = allItemsCollapsed(currentDisclosureKind, currentDisclosureKeys);
  const status: ProxyConfigStatusView = store.authority; const stats = { connections: store.stats.connections, uploadSpeed: formatBytes(store.stats.uploadSpeed), downloadSpeed: formatBytes(store.stats.downloadSpeed), uploadTotal: formatBytes(store.stats.uploadTotal), downloadTotal: formatBytes(store.stats.downloadTotal), mode: ({ direct: "直连", rule: "规则", global: "全局" } as Record<string, string>)[store.stats.mode] || store.stats.mode };
  const activeJob = useMemo(() => Object.values(testingJobs).filter((job) => job.status === "queued" || job.status === "running").at(-1) || Object.values(testingJobs).at(-1), [testingJobs]);
  const activeTestingKeys = useMemo(() => {
    const keys = new Set<string>();
    if (testingTarget) keys.add(testingTarget);
    Object.values(testingJobs).forEach((job) => {
      if (job.status !== "queued" && job.status !== "running") return;
      job.physicalKeys?.forEach((key) => keys.add(key));
      job.displayKeys?.forEach((key) => keys.add(key));
    });
    return keys;
  }, [testingJobs, testingTarget]);
  const uiJob = activeJob ? { ...activeJob, scope: activeJob.scope, status: activeJob.status } : undefined;
  const regexError = compileSafeSearch(search, { regex }).error;

  const collapseAll = () => setAllCollapsed(currentDisclosureKind, currentDisclosureKeys);
  const openGroupManager = () => setGroupManagerOpen(true);
  const createGroup = () => { setGroupManagerOpen(false); setEditorKey(""); setGroupDraft({ name: "", type: "select", icon: "", proxies: "", url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing", policyPriority: "", uselightgbm: false, collectdata: false, sampleRate: 0, preferAsn: false, advanced: "{}" }); setEditor("group"); };
  const createProvider = () => { setProviderManagerOpen(false); setEditorKey(""); setProviderDraft(undefined); setEditor("provider"); };
  const moveGroup = (fromKey: string, toKey: string) => { const order = mergeStableOrder(settings.groupOrder.length ? settings.groupOrder : store.groupKeys, settings.groupOrder, store.groupKeys); const from = order.indexOf(fromKey); const to = order.indexOf(toKey); if (from < 0 || to < 0) return; order.splice(from, 1); order.splice(to, 0, fromKey); setSettings((current) => ({ ...current, groupOrder: order })); };
  const toggleUserHiddenGroup = (group: ProxyGroupView) => setSettings((current) => ({ ...current, hiddenGroups: current.hiddenGroups.includes(group.name) ? current.hiddenGroups.filter((name) => name !== group.name) : [...current.hiddenGroups, group.name] }));
  const switchMode = async (label: string) => { const mode = ({ "直连": "direct", "规则": "rule", "全局": "global" } as Record<string, string>)[label] || label; try { await api("/api/v1/mihomo/controller/configs", { method: "PATCH", body: JSON.stringify({ mode }) }); await runtime.refresh({ silent: true }); } catch (cause) { showToast(cause instanceof Error ? cause.message : "切换模式失败"); } };
  const testGroup = async (group: ProxyGroupView, node?: ProxyNodeView) => { setTestingTarget(node?.key || group.key); try { const job = node ? await runtime.testNode(node.key as ProxyKey, { groupKey: group.key as ProxyKey }) : await runtime.testGroup(group.key as ProxyKey); showToast(job.status === "cancelled" ? "测速已取消" : "测速完成"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "测速失败"); } finally { setTestingTarget(null); } };
  const testProvider = async (provider: ProxyProviderView, node?: ProxyNodeView) => { setTestingTarget(node?.key || provider.id); try { const job = node ? await runtime.testNode(node.key as ProxyKey) : await runtime.testProvider(provider.id); showToast(job.status === "done" && job.failed ? "更新失败，正在使用旧缓存" : node ? "节点测速完成" : "供应商健康检查完成"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "健康检查失败"); } finally { setTestingTarget(null); } };
  const updateProvider = async (provider: ProxyProviderView) => { setUpdatingProvider(provider.id); try { await api(`/api/v1/mihomo/proxy-providers/${encodeURIComponent(provider.name)}/update`, { method: "POST" }); showToast(`正在更新 ${provider.name}，旧缓存保留至成功`); await runtime.refresh({ silent: true }); } catch (cause) { showToast(cause instanceof Error ? cause.message : "更新失败，正在使用旧缓存"); } finally { setUpdatingProvider(null); } };
  const selectNode = async (group: ProxyGroupView, node: ProxyNodeView) => { try { const result = asRecord(await runtime.selectProxy(group.key as ProxyKey, node.key as ProxyKey)); const disconnect = asRecord(result.disconnect); const closed = Number(disconnect.closed || 0); const failed = Array.isArray(disconnect.failedIds) ? disconnect.failedIds.length : 0; showToast(settings.autoDisconnectOnSwitch ? `${group.name} → ${node.name}；已关闭 ${closed} 条受影响连接${failed ? `，${failed} 条关闭失败` : ""}` : `${group.name} → ${node.name}`); } catch (cause) { showToast(cause instanceof Error ? cause.message : "切换节点失败"); } };

  const openProvider = (provider: ProxyProviderView) => { const original = store.providers[provider.id]?.raw; const raw = asRecord(original); const health = asRecord(raw["health-check"]); setEditorKey(provider.id); setProviderDraft({ name: provider.name, type: provider.vehicleType || "http", url: String(raw.url || ""), path: String(raw.path || ""), interval: Number(raw.interval || 86400), healthCheckEnable: Boolean(health.enable), healthCheckUrl: String(health.url || ""), healthCheckInterval: Number(health.interval || 300), healthCheckLazy: health.lazy !== false, advanced: JSON.stringify(original || {}, null, 2) }); setEditor("provider"); void api(`/api/v1/mihomo/proxy-providers/${encodeURIComponent(provider.name)}`).then((payload) => { const latest = asRecord(apiData(payload, payload)); const latestHealth = asRecord(latest["health-check"]); setProviderDraft((current) => current ? { ...current, name: String(latest.name || current.name), type: String(latest.type || current.type), url: String(latest.url || current.url), path: String(latest.path || current.path), interval: Number(latest.interval || current.interval), healthCheckEnable: latestHealth.enable == null ? current.healthCheckEnable : Boolean(latestHealth.enable), healthCheckUrl: String(latestHealth.url || current.healthCheckUrl), healthCheckInterval: Number(latestHealth.interval || current.healthCheckInterval), healthCheckLazy: latestHealth.lazy == null ? current.healthCheckLazy : Boolean(latestHealth.lazy), advanced: JSON.stringify(latest, null, 2) } : current); }).catch(() => undefined); };
  const openProviderManager = () => setProviderManagerOpen(true);
  const openGroup = (group: ProxyGroupView) => {
    setEditorKey(group.key);
    setGroupDraft({ name: group.name, type: group.type, icon: group.icon || "", proxies: "", url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing", policyPriority: "", uselightgbm: false, collectdata: false, sampleRate: 0, preferAsn: false, advanced: "{}" });
    setGroupConfigLoading(true);
    setEditor("group");
    void api("/api/v1/mihomo/proxy-groups-config").then((payload) => {
      const latest = proxyGroupRows(payload).find((row) => String(row.name || "") === group.name);
      if (!latest) throw new Error(`静态配置中未找到策略组 ${group.name}`);
      setGroupDraft(proxyGroupDraft(latest));
    }).catch((cause) => {
      showToast(cause instanceof Error ? cause.message : "读取代理组配置失败");
      setEditor(null);
    }).finally(() => setGroupConfigLoading(false));
  };
  const chooseGroupForEditing = (group: ProxyGroupView) => { setGroupManagerOpen(false); openGroup(group); };
  const deleteProvider = async (item: ProxyCollectionItem) => { if (!status.canEditProviders) throw new Error("当前配置不允许删除订阅供应商"); await api(`/api/v1/mihomo/proxy-providers/${encodeURIComponent(item.name)}`, { method: "DELETE" }); showToast(`已删除供应商 ${item.name}`); await runtime.refresh({ silent: true }); };
  const deleteGroup = async (item: ProxyCollectionItem) => { if (!status.canEditGroups) throw new Error("生成配置中的策略组只读，请切换到自定义配置后再删除"); const currentPayload = await api("/api/v1/mihomo/proxy-groups-config"); const currentData = apiData(currentPayload, currentPayload); const currentValue = Array.isArray(currentData) ? currentData : asRecord(currentData)["proxy-groups"] ?? asRecord(currentData).proxy_groups ?? asRecord(currentData).groups; const currentRows = Array.isArray(currentValue) ? currentValue.map(asRecord) : []; const nextRows = currentRows.filter((row) => String(row.name || "") !== item.name); if (nextRows.length === currentRows.length) throw new Error(`未找到策略组 ${item.name}，未执行删除`); await api("/api/v1/mihomo/proxy-groups-config", { method: "PUT", body: JSON.stringify({ "proxy-groups": nextRows }) }); showToast(`已删除策略组 ${item.name}`); await runtime.refresh({ silent: true }); };
  const openManual = async () => { setEditorKey("manual"); setManualDraft({ mode: "links", links: "", yaml: "" }); setEditor("manual"); try { const payload = await api("/api/v1/mihomo/manual-proxies"); const data = asRecord(apiData(payload, payload)); const mode = data.input_mode === "yaml" ? "yaml" : "links"; const content = String(data.content || ""); setManualDraft({ mode, links: mode === "links" ? content : "", yaml: mode === "yaml" ? content : "" }); } catch { /* empty draft is still useful for first-time setup */ } };
  const groupMutationPayload = async (draft: unknown) => {
    const row = asRecord(draft);
    const name = String(row.name || "").trim();
    if (!name) throw new Error("策略组名称不能为空");
    const originalName = editorKey ? parseProxyKey(editorKey as ProxyKey).name : name;
    const currentRows = proxyGroupRows(await api("/api/v1/mihomo/proxy-groups-config"));
    const nextRow = buildProxyGroupRow(row as unknown as ProxyGroupDraftView);
    return { "proxy-groups": replaceProxyGroup(currentRows, originalName, nextRow) };
  };
  const validateDraft = async (scope: string, draft: unknown) => {
    const row = asRecord(draft);
    const candidate = scope === "manual-proxies" ? { content: row.mode === "yaml" ? row.yaml : row.links } : scope === "proxy-groups" ? await groupMutationPayload(draft) : draft;
    const payload = await api("/api/v1/mihomo/proxy-config/validate", { method: "POST", body: JSON.stringify({ scope, draft: candidate }) });
    return validationMessage(payload);
  };
  const saveEditor = async (scope: "provider" | "group" | "manual", draft: unknown) => {
    setEditorBusy(scope);
    try {
      let path = scope === "group" ? "/api/v1/mihomo/proxy-groups-config" : "/api/v1/mihomo/manual-proxies";
      let method: "PATCH" | "PUT" = "PUT";
      let body: unknown = draft;
      if (scope === "provider") {
        const row = asRecord(draft);
        const name = String(row.name || "").trim();
        if (!name) throw new Error("供应商名称不能为空");
        const advanced = typeof row.advanced === "string" && row.advanced.trim() ? asRecord(JSON.parse(row.advanced)) : {};
        path = `/api/v1/mihomo/proxy-providers/${encodeURIComponent(editorKey || name)}`;
        method = editorKey ? "PATCH" : "PUT";
        body = { ...advanced, name, type: row.type, url: row.url, path: row.path, interval: row.interval, "health-check": { ...asRecord(advanced["health-check"]), enable: Boolean(row.healthCheckEnable), url: row.healthCheckUrl, interval: row.healthCheckInterval, lazy: Boolean(row.healthCheckLazy) } };
      }
      if (scope === "group") {
        body = await groupMutationPayload(draft);
      }
      if (scope === "manual") {
        const row = asRecord(draft);
        body = { mode: row.mode, content: row.mode === "yaml" ? row.yaml : row.links };
      }
      const payload = await api(path, { method, body: JSON.stringify(body) });
      const response = asRecord(payload);
      const result = asRecord(apiData(payload, payload));
      const restarted = response.restarted ?? result.restarted;
      showToast(restarted === false ? "已保存（未重启 Mihomo）" : "已保存并生效（已重启并通过运行探测）");
      setEditor(null);
      await runtime.refresh({ silent: true });
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "保存失败，未关闭编辑器");
      throw cause;
    } finally {
      setEditorBusy(null);
    }
  };

  const chain = chainGroup ? runtime.resolveChain(chainGroup.key as ProxyKey) : undefined;
  const chainView = chain ? { path: chain.path.map((key) => store.entities[key]?.name || parseProxyKey(key).name), finalKey: chain.finalKey ? store.entities[chain.finalKey]?.name : undefined, cycleDetected: chain.cycleDetected, missing: chain.missingKey ? [parseProxyKey(chain.missingKey).name] : undefined } : undefined;
  const settingsView: ProxySettingsView = settings;
  const groupManagerItems: ProxyCollectionItem[] = groups.map((group) => ({ id: group.key, name: group.name, subtitle: `${group.type} · ${group.nodes.length} 个节点`, readOnly: !status.canEditGroups, generated: !status.canEditGroups, readOnlyReason: "当前为默认/生成配置，策略组由 MSF 管理；切换到自定义配置后才能修改。" }));
  const providerManagerItems: ProxyCollectionItem[] = providers.map((provider) => ({ id: provider.id, name: provider.name, subtitle: `${provider.vehicleType || "Provider"} · ${provider.total ?? provider.nodes.length} 个节点`, readOnly: !status.canEditProviders, readOnlyReason: "当前配置不允许修改订阅供应商。" }));
  const testingAll = Boolean(activeJob?.scope === "all" && (activeJob.status === "queued" || activeJob.status === "running"));

  return (
    <AppShell>
      <div className="space-y-4">
        <ProxyPageHeader
          stats={stats}
          configStatus={status}
          loading={loading || refreshing}
          autoRefresh={autoRefresh}
          onRefresh={() => void runtime.refresh()}
          onToggleAutoRefresh={() => setAutoRefresh((value) => !value)}
          onCollapseAll={collapseAll}
          allCollapsed={allCollapsed}
        />
        <ProxyToolbar
          tab={tab}
          onTabChange={setTab}
          onTestAll={() => void runtime.testAll()}
          testingAll={testingAll}
          groupCount={visibleGroups.length}
          providerCount={providers.length}
          mode={stats.mode}
          onModeChange={(value) => void switchMode(value)}
          search={search}
          onSearchChange={setSearch}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          regex={regex}
          onRegexChange={setRegex}
          regexError={regexError}
          sortBy={settings.sortBy}
          onSortChange={(value) => setSettings((current) => ({ ...current, sortBy: value as ProxyPageSettings["sortBy"] }))}
          typeFilter={typeFilter}
          typeOptions={typeOptions}
          onTypeFilterChange={setTypeFilter}
          onSettings={() => setSettingsOpen(true)}
          reorderEnabled={reorderEnabled}
          onReorderToggle={() => setReorderEnabled((value) => !value)}
          onRestoreOrder={() => setSettings((current) => ({ ...current, groupOrder: [] }))}
        />
        {uiJob ? <ProxyLatencyProgress job={uiJob} onCancel={() => Object.values(testingJobs).filter((job) => job.status === "queued" || job.status === "running").forEach((job) => runtime.cancelTest(job.id))} /> : null}
        <p className="text-xs text-muted-foreground">{store.fetchedAt ? `运行态更新于 ${new Date(store.fetchedAt).toLocaleTimeString()}` : "正在连接 Mihomo Controller…"}</p>

        {tab === "groups" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">策略组</p>
              <GlassButton type="button" variant="tool" className="h-9 px-3 text-xs" onClick={openGroupManager} title={status.canEditGroups ? "新增、编辑或删除策略组" : "当前为生成配置，可查看策略组但不能修改"}>
                <Settings2 className="h-4 w-4" />管理策略组
              </GlassButton>
            </div>
            <ProxyGroupList
              groups={visibleGroups}
              loading={loading}
              collapsed={(key) => collapsed("group", key)}
              onToggle={(key) => toggleCollapse("group", key)}
              testing={testingTarget}
              testingKeys={activeTestingKeys}
              hideUnavailable={settings.hideUnavailable}
              nodeDisplay={settings.nodeNameDisplay}
              previewType={settings.proxyPreviewType}
              groupByProvider={settings.groupProxiesByProvider}
              minCardWidth={settings.minProxyCardWidth}
              cardSize={settings.proxyCardSize}
              groupIconSize={settings.proxyGroupIconSize}
              groupIconMargin={settings.proxyGroupIconMargin}
              displayFinalOutbound={settings.displayFinalOutbound}
              disableTextSelect={settings.disableProxiesPageTextSelect}
              manageHiddenGroups={settings.manageHiddenGroups}
              low={settings.delayLowMs}
              high={settings.delayHighMs}
              onSelect={selectNode}
              onTest={testGroup}
              onChain={setChainGroup}
              onEdit={openGroup}
              onToggleHidden={toggleUserHiddenGroup}
              reorderEnabled={reorderEnabled}
              onMove={moveGroup}
              doubleColumn={settings.doubleColumn}
            />
          </>
        ) : (
          <>
            <ProxyProviderList
              providers={providers}
              loading={loading}
              collapsed={(key) => collapsed("provider", key)}
              onToggle={(key) => toggleCollapse("provider", key)}
              testing={testingTarget}
              testingKeys={activeTestingKeys}
              updating={updatingProvider}
              hideUnavailable={settings.hideUnavailable}
              nodeDisplay={settings.nodeNameDisplay}
              minCardWidth={settings.minProxyCardWidth}
              cardSize={settings.proxyCardSize}
              disableTextSelect={settings.disableProxiesPageTextSelect}
              low={settings.delayLowMs}
              high={settings.delayHighMs}
              onTest={testProvider}
              onUpdate={updateProvider}
              onEdit={openProvider}
              doubleColumn={settings.doubleColumn}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <GlassButton type="button" variant="tool" className="h-9 px-3 text-xs" onClick={openProviderManager}>
                <Settings2 className="h-4 w-4" />管理订阅供应商
              </GlassButton>
              <GlassButton type="button" variant="tool" className="h-9 px-3 text-xs" disabled={!status.canEditManualNodes} onClick={() => void openManual()}>
                <Plus className="h-4 w-4" />管理自定义节点
              </GlassButton>
            </div>
          </>
        )}
      </div>
      <ProxyChainDialog open={Boolean(chainGroup)} groupName={chainGroup?.name} chain={chainView} onClose={() => setChainGroup(null)} />
      <ProxySettingsDialog open={settingsOpen} settings={settingsView} onChange={(value) => setSettings((current) => ({ ...current, ...value, sortBy: value.sortBy as ProxyPageSettings["sortBy"] }))} onClose={() => setSettingsOpen(false)} onReset={resetSettings} />
      <ProxyCollectionManagerDialog open={groupManagerOpen} kind="group" items={groupManagerItems} canCreate={status.canEditGroups} onClose={() => setGroupManagerOpen(false)} onCreate={createGroup} onEdit={(item) => { const group = groups.find((candidate) => candidate.key === item.id); if (group) chooseGroupForEditing(group); }} onDelete={deleteGroup} />
      <ProxyCollectionManagerDialog open={providerManagerOpen} kind="provider" items={providerManagerItems} canCreate={status.canEditProviders} onClose={() => setProviderManagerOpen(false)} onCreate={createProvider} onEdit={(item) => { const provider = providers.find((candidate) => candidate.id === item.id); if (provider) { setProviderManagerOpen(false); openProvider(provider); } }} onDelete={deleteProvider} />
      <ProxyProviderEditorDialog open={editor === "provider"} value={providerDraft} onClose={() => setEditor(null)} onValidate={(draft) => validateDraft("proxy-providers", draft)} onSave={(draft) => saveEditor("provider", draft)} />
      <ProxyGroupEditorDialog open={editor === "group"} readOnly={!status.canEditGroups} loading={groupConfigLoading} value={groupDraft} onClose={() => setEditor(null)} onValidate={(draft) => validateDraft("proxy-groups", draft)} onSave={(draft) => saveEditor("group", draft)} />
      <ProxyManualNodeEditorDialog open={editor === "manual"} value={manualDraft} onClose={() => setEditor(null)} onValidate={(draft) => validateDraft("manual-proxies", draft)} onSave={(draft) => saveEditor("manual", draft)} />
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
