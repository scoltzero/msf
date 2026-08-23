"use client";

import { useEffect, useMemo, useState } from "react";
import { Waypoints } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { ProxyGroupCard } from "@/components/mihomo/proxies/ProxyGroupCard";
import type { ProxyGroupView, ProxyNodeView } from "@/components/mihomo/proxies/types";
import { readProxySettings } from "@/features/mihomo-proxies/settings";
import { proxyDelay, resolveProxyChain, selectGroups, selectGroupNodes } from "@/features/mihomo-proxies/selectors";
import type { ProxyEntity, ProxyKey, ProxyStore } from "@/features/mihomo-proxies/types";
import type { ProxyRuntimeTestJob } from "@/features/mihomo-proxies/useProxyRuntime";
import { useProxyGroupTraffic } from "@/features/mihomo-proxies/useProxyGroupTraffic";
import { useDashboardProxyRuntime } from "../../data/useDashboardProxyRuntime";

export type MihomoProxyGroupWidgetProps = {
  groupKey?: string;
  onGroupKeyChange?: (groupKey: string) => void;
  showGroupSelector?: boolean;
  size?: "s" | "m" | "l";
};

export function MihomoProxyGroupSelector({ groupKey, onGroupKeyChange }: { groupKey?: string; onGroupKeyChange: (groupKey: string) => void }) {
  const { store, loading } = useDashboardProxyRuntime();
  const groups = useMemo(() => selectGroups(store), [store]);
  const selected = resolveDashboardProxyGroup(store, groupKey);
  return <select aria-label="选择策略组" value={selected?.key ?? ""} onChange={(event) => onGroupKeyChange(event.target.value)} disabled={loading || !groups.length} className="gary-field h-8 max-w-28 rounded-lg pl-2 pr-7 text-[11px] sm:max-w-40">
    <option value="">{loading ? "正在加载…" : groups.length ? "选择策略组" : "暂无策略组"}</option>
    {groups.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
  </select>;
}

export function resolveDashboardProxyGroup(store: ProxyStore, groupKey?: string): ProxyEntity | undefined {
  if (!groupKey) return undefined;
  const entity = store.entities[groupKey as ProxyKey];
  return entity?.kind === "group" ? entity : undefined;
}

export function activeProxyTestJob(jobs: Record<string, ProxyRuntimeTestJob>, key: string | undefined) {
  if (!key) return undefined;
  return Object.values(jobs).find((job) =>
    (job.status === "queued" || job.status === "running") &&
    (job.scopeKey === key || job.physicalKeys?.includes(key as ProxyKey) || job.displayKeys?.includes(key as ProxyKey)),
  );
}

function nodeView(store: ProxyStore, entity: ProxyEntity): ProxyNodeView {
  const chain = entity.kind === "group" ? resolveProxyChain(entity.key, store) : undefined;
  const finalEntity = chain?.finalKey ? store.entities[chain.finalKey] : undefined;
  return {
    key: entity.key,
    name: entity.name,
    type: entity.type,
    kind: entity.kind,
    delay: proxyDelay(finalEntity ?? entity),
    alive: finalEntity?.alive ?? entity.alive,
    hidden: entity.hidden,
    icon: entity.icon,
    providerName: entity.providerName,
  };
}

/** Build the exact view model consumed by the proxy page's shared strategy-group card. */
export function dashboardProxyGroupView(
  store: ProxyStore,
  group: ProxyEntity,
  options: { pendingSelection?: ProxyKey; trafficSpeed?: number } = {},
): ProxyGroupView {
  const selectedKey = options.pendingSelection ?? group.selectedKey;
  const selected = selectedKey ? store.entities[selectedKey] : undefined;
  const chain = resolveProxyChain(group.key, store);
  const finalNode = chain.finalKey ? store.entities[chain.finalKey] : undefined;
  return {
    key: group.key,
    name: group.name,
    type: group.type,
    icon: group.icon,
    nodes: selectGroupNodes(store, group.key, true).map((node) => nodeView(store, node)),
    selectedKey,
    selectedName: selected?.name,
    selectedIcon: selected?.icon,
    finalOutboundKey: finalNode?.key,
    finalOutboundName: finalNode?.name,
    finalOutboundIcon: finalNode?.icon,
    finalOutboundProvider: finalNode?.providerName,
    delay: proxyDelay(finalNode ?? selected ?? group),
    trafficSpeed: Math.max(0, options.trafficSpeed ?? 0),
    hidden: group.hidden,
    readOnly: !store.authority.canEditGroups,
  };
}

export function activeProxyTestingKeys(jobs: Record<string, ProxyRuntimeTestJob>): ReadonlySet<string> {
  const keys = new Set<string>();
  Object.values(jobs).forEach((job) => {
    if (job.status !== "queued" && job.status !== "running") return;
    if (job.scopeKey) keys.add(job.scopeKey);
    job.physicalKeys?.forEach((key) => keys.add(key));
    job.displayKeys?.forEach((key) => keys.add(key));
  });
  return keys;
}

export function MihomoProxyGroupWidget({ groupKey, onGroupKeyChange, showGroupSelector = true, size = "m" }: MihomoProxyGroupWidgetProps) {
  const runtime = useDashboardProxyRuntime();
  const { store, loading, refreshing, testingJobs, pendingSelections } = runtime;
  const [internalKey, setInternalKey] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const selectedKey = groupKey ?? internalKey;
  const groups = useMemo(() => selectGroups(store), [store]);
  const group = resolveDashboardProxyGroup(store, selectedKey);
  const missing = Boolean(selectedKey && !group && !loading);
  const { groupTraffic, error: trafficError } = useProxyGroupTraffic({ enabled: Boolean(group), intervalMs: 2_000 });
  const proxySettings = readProxySettings();

  useEffect(() => {
    setCollapsed(true);
    setMessage("");
  }, [groupKey]);

  const choose = (value: string) => {
    if (groupKey === undefined) setInternalKey(value);
    onGroupKeyChange?.(value);
    setCollapsed(true);
    setMessage("");
  };

  if (!selectedKey || !group) {
    return <div className="flex h-full min-h-36 flex-col items-center justify-center gap-3 text-center">
      <SolidPlate tone="subtle" className="flex h-11 w-11 items-center justify-center rounded-full"><Waypoints className="h-5 w-5 text-muted-foreground" /></SolidPlate>
      <div><p className="text-sm font-medium">{missing ? "原策略组已删除或改名" : "选择要控制的策略组"}</p><p className="mt-1 text-xs text-muted-foreground">{missing ? "请重新选择，组件不会自动绑定到其他组" : "多个组件可以选择相同或不同策略组"}</p></div>
      {showGroupSelector ? <select aria-label="选择策略组" value={missing ? "" : selectedKey} onChange={(event) => choose(event.target.value)} disabled={loading || !groups.length} className="gary-field h-9 w-full max-w-64 rounded-xl px-3 text-xs"><option value="">{loading ? "正在加载…" : groups.length ? "请选择策略组" : "暂无可用策略组"}</option>{groups.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select> : null}
    </div>;
  }

  const selectionPending = pendingSelections[group.key];
  const cardGroup = dashboardProxyGroupView(store, group, {
    pendingSelection: selectionPending,
    trafficSpeed: groupTraffic[group.name]?.total,
  });
  const testingKeys = new Set(activeProxyTestingKeys(testingJobs));
  if (testingTarget) testingKeys.add(testingTarget);

  const select = async (node: ProxyNodeView) => {
    if (node.key === group.selectedKey || selectionPending) return;
    setMessage("");
    try {
      await runtime.selectProxy(group.key, node.key as ProxyKey);
      setMessage(`已切换到 ${node.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "切换失败，已恢复原节点");
    }
  };

  const test = async (node?: ProxyNodeView) => {
    const target = node?.key ?? group.key;
    if (testingKeys.has(target)) return;
    setTestingTarget(target);
    setMessage("");
    try {
      const job = node
        ? await runtime.testNode(node.key as ProxyKey, { groupKey: group.key })
        : await runtime.testGroup(group.key);
      setMessage(node
        ? job.failed ? `${node.name} 测速失败` : `${node.name} 测速完成`
        : `整组测速完成：成功 ${job.succeeded}，失败 ${job.failed}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测速失败");
    } finally {
      setTestingTarget(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-stretch gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showGroupSelector ? <div className="flex shrink-0 justify-end">
        <select aria-label="更换策略组" value={group.key} onChange={(event) => choose(event.target.value)} className="gary-field h-7 max-w-44 rounded-lg px-2 text-[10px]">
          {groups.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>
      </div> : null}
      <ProxyGroupCard
        embedded
        group={cardGroup}
        collapsed={collapsed}
        testing={testingTarget}
        testingKeys={testingKeys}
        hideUnavailable={proxySettings.hideUnavailable}
        nodeDisplay={proxySettings.nodeNameDisplay}
        previewType={proxySettings.proxyPreviewType}
        groupByProvider={proxySettings.groupProxiesByProvider}
        minCardWidth={size === "s" ? Math.min(120, proxySettings.minProxyCardWidth) : proxySettings.minProxyCardWidth}
        cardSize={size === "s" ? "compact" : proxySettings.proxyCardSize}
        groupIconSize={proxySettings.proxyGroupIconSize}
        groupIconMargin={proxySettings.proxyGroupIconMargin}
        displayFinalOutbound={proxySettings.displayFinalOutbound}
        disableTextSelect={proxySettings.disableProxiesPageTextSelect}
        low={proxySettings.delayLowMs}
        high={proxySettings.delayHighMs}
        onToggle={() => setCollapsed((value) => !value)}
        onSelect={(node) => void select(node)}
        onTest={(node) => void test(node)}
      />
      {message || runtime.error || trafficError ? <p aria-live="polite" className="shrink-0 truncate px-1 text-[10px] text-muted-foreground" title={message || runtime.error || trafficError}>{message || runtime.error || trafficError}</p> : refreshing ? <p className="shrink-0 px-1 text-[10px] text-muted-foreground">正在同步代理状态…</p> : null}
    </div>
  );
}
