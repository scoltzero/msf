"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import {
  DASHBOARD_LAYOUT_COMMAND_EVENT,
  DASHBOARD_LAYOUT_STATE_EVENT,
  DASHBOARD_SETTINGS_EVENT,
  createDefaultDashboardSettings,
  loadDashboardSettings,
  saveDashboardSettings,
  type DashboardLayoutCommand,
  type DashboardSettings,
  type DashboardWidgetInstance,
} from "@/lib/dashboard-settings";
import { DashboardDataProvider, DashboardProxyRuntimeProvider, MihomoDashboardProvider, MosdnsDashboardProvider, mihomoDashboardScopesForWidgetTypes, useMihomoDashboardData } from "./data";
import {
  MosdnsCacheStatsWidget,
  MosdnsCacheSystemWidget,
  MosdnsInfoWidget,
  MosdnsQueryWidget,
  MosdnsResolutionPolicyWidget,
  MosdnsRuntimeWidget,
  MOSDNS_CACHE_OPTIONS,
  MOSDNS_INFO_OPTIONS,
  type MosdnsCachePage,
  type MosdnsCacheSystemPage,
  type MosdnsInfoPage,
  type MosdnsRuntimePage,
} from "./widgets/mosdns";
import {
  MihomoConnectionStatsWidget,
  MihomoGlobeWidget,
  MihomoLatencyWidget,
  MihomoProviderTrafficWidget,
  MihomoProxyGroupSelector,
  MihomoProxyGroupWidget,
  MihomoRuleHitsWidget,
  MihomoTopologyWidget,
  MihomoTrafficWidget,
} from "./widgets/mihomo";
import {
  MihomoServiceWidget,
  MosdnsServiceWidget,
  SystemInfoCollectionWidget,
  SystemRateWidget,
  SystemResourcesWidget,
  SYSTEM_INFO_OPTIONS,
  type SystemInfoPage,
} from "./widgets/system";
import { DashboardGrid, type DashboardRenderSize } from "./DashboardGrid";
import { DashboardCollectionHeaderControl } from "./DashboardCollectionTabs";

function MissingWidget({ type }: { type: string }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <Puzzle className="h-6 w-6 opacity-60" />
      <p className="text-xs">{type} 组件正在接入</p>
    </div>
  );
}

function cloneSettings(settings: DashboardSettings) {
  return JSON.parse(JSON.stringify(settings)) as DashboardSettings;
}

function cloneLayouts(layouts: DashboardSettings["layouts"]) {
  return JSON.parse(JSON.stringify(layouts)) as DashboardSettings["layouts"];
}

type DashboardEditHistoryEntry =
  | { kind: "layouts"; layouts: DashboardSettings["layouts"] }
  | { kind: "settings"; settings: DashboardSettings };

function storedPage<T extends string>(instance: DashboardWidgetInstance, allowed: readonly T[], fallback: T): T {
  const page = instance.settings?.activePage;
  return typeof page === "string" && allowed.includes(page as T) ? page as T : fallback;
}

function storedPages<T extends string>(instance: DashboardWidgetInstance, allowed: readonly T[]): T[] {
  const pages = Array.isArray(instance.settings?.pages)
    ? instance.settings.pages.filter((page): page is T => typeof page === "string" && allowed.includes(page as T))
    : [];
  const unique = [...new Set(pages)];
  return unique.length ? unique : [allowed[0]];
}

function ConnectedGlobeWidget({ size, editing }: { size: "m" | "l"; editing: boolean }) {
  const { connections } = useMihomoDashboardData();
  return <MihomoGlobeWidget connections={connections} size={size} editing={editing} />;
}

function ConnectedTopologyWidget({ size, editing }: { size: "m" | "l"; editing: boolean }) {
  const { connections } = useMihomoDashboardData();
  return <MihomoTopologyWidget connections={connections} size={size} editing={editing} />;
}

export function Dashboard() {
  const [settings, setSettings] = useState<DashboardSettings>(() => loadDashboardSettings());
  const [editing, setEditing] = useState(false);
  const settingsRef = useRef(settings);
  const editHistoryRef = useRef<DashboardEditHistoryEntry[]>([]);
  const mihomoScopes = useMemo(() => mihomoDashboardScopesForWidgetTypes(settings.instances.map((instance) => instance.type)), [settings.instances]);
  const connectionHistoryRequested = settings.instances.some((instance) => instance.type === "mihomo-connection-stats");

  const applySettings = useCallback((next: DashboardSettings, persist = true) => {
    settingsRef.current = next;
    setSettings(next);
    if (persist) saveDashboardSettings(next);
  }, []);

  const publishLayoutState = useCallback((isEditing: boolean, canUndo = editHistoryRef.current.length > 0) => {
    window.dispatchEvent(new CustomEvent(DASHBOARD_LAYOUT_STATE_EVENT, { detail: { editing: isEditing, canUndo } }));
  }, []);

  const rememberLayoutInteraction = useCallback(() => {
    const history = editHistoryRef.current;
    history.push({ kind: "layouts", layouts: cloneLayouts(settingsRef.current.layouts) });
    if (history.length > 50) history.shift();
    publishLayoutState(true, true);
  }, [publishLayoutState]);

  useEffect(() => {
    const syncSettings = () => {
      const next = loadDashboardSettings();
      settingsRef.current = next;
      setSettings(next);
    };
    window.addEventListener(DASHBOARD_SETTINGS_EVENT, syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener(DASHBOARD_SETTINGS_EVENT, syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command?: DashboardLayoutCommand }>).detail?.command;
      if (command === "edit") {
        editHistoryRef.current = [];
        setEditing(true);
        publishLayoutState(true, false);
      } else if (command === "done") {
        editHistoryRef.current = [];
        setEditing(false);
        publishLayoutState(false, false);
      } else if (command === "undo") {
        const previous = editHistoryRef.current.pop();
        if (previous?.kind === "settings") {
          applySettings(previous.settings);
        } else if (previous?.kind === "layouts") {
          const current = settingsRef.current;
          const currentIds = new Set(current.instances.map((instance) => instance.id));
          const mergeBreakpoint = (key: keyof DashboardSettings["layouts"]) => {
            const restored = previous.layouts[key].filter((item) => currentIds.has(item.i));
            const restoredIds = new Set(restored.map((item) => item.i));
            return [...restored, ...current.layouts[key].filter((item) => !restoredIds.has(item.i))];
          };
          applySettings({
            ...current,
            layouts: {
              desktop: mergeBreakpoint("desktop"),
              tablet: mergeBreakpoint("tablet"),
              mobile: mergeBreakpoint("mobile"),
            },
          });
        }
        publishLayoutState(true, editHistoryRef.current.length > 0);
      } else if (command === "reset") {
        const initial = createDefaultDashboardSettings();
        if (JSON.stringify(settingsRef.current) !== JSON.stringify(initial)) {
          editHistoryRef.current.push({ kind: "settings", settings: cloneSettings(settingsRef.current) });
          if (editHistoryRef.current.length > 50) editHistoryRef.current.shift();
          applySettings(initial);
        }
        publishLayoutState(true, editHistoryRef.current.length > 0);
      }
    };
    window.addEventListener(DASHBOARD_LAYOUT_COMMAND_EVENT, onCommand);
    publishLayoutState(false, false);
    return () => window.removeEventListener(DASHBOARD_LAYOUT_COMMAND_EVENT, onCommand);
  }, [applySettings, publishLayoutState]);

  const updateInstanceSettings = (instance: DashboardWidgetInstance, patch: Record<string, unknown>) => {
    applySettings({
      ...settingsRef.current,
      instances: settingsRef.current.instances.map((item) => item.id === instance.id ? { ...item, settings: { ...item.settings, ...patch } } : item),
    });
  };

  const renderWidget = (instance: DashboardWidgetInstance, size: DashboardRenderSize) => {
    const standardSize = size === "xs" ? "s" : size;
    switch (instance.type) {
      case "system-info": {
        const allowed = ["device", "hardware", "stats"] as const;
        const pages = storedPages<SystemInfoPage>(instance, allowed);
        const activePage = storedPage<SystemInfoPage>(instance, allowed, pages[0]);
        return <SystemInfoCollectionWidget pages={pages} activePage={activePage} showNavigation={false} size={standardSize} />;
      }
      case "system-device": return <SystemInfoCollectionWidget pages={["device"]} activePage="device" size={standardSize} />;
      case "system-hardware": return <SystemInfoCollectionWidget pages={["hardware"]} activePage="hardware" size={standardSize} />;
      case "system-stats": return <SystemInfoCollectionWidget pages={["stats"]} activePage="stats" size={standardSize} />;
      case "system-resources": return <SystemResourcesWidget size={standardSize} />;
      case "system-rate": return <SystemRateWidget size={standardSize} />;
      case "mosdns-service": return <MosdnsServiceWidget />;
      case "mosdns-query": return <MosdnsQueryWidget size={size} />;
      case "mosdns-info": {
        const allowed = ["split", "domains", "slowest", "clients"] as const;
        const pages = storedPages<MosdnsInfoPage>(instance, allowed);
        const activePage = storedPage<MosdnsInfoPage>(instance, allowed, pages[0]);
        return <MosdnsInfoWidget size={size} pages={pages} activePage={activePage} showNavigation={false} />;
      }
      case "mosdns-info-split": return <MosdnsInfoWidget size={size} pages={["split"]} activePage="split" />;
      case "mosdns-info-domains": return <MosdnsInfoWidget size={size} pages={["domains"]} activePage="domains" />;
      case "mosdns-info-slowest": return <MosdnsInfoWidget size={size} pages={["slowest"]} activePage="slowest" />;
      case "mosdns-info-clients": return <MosdnsInfoWidget size={size} pages={["clients"]} activePage="clients" />;
      case "mosdns-cache-stats": {
        const allowed = ["all", "domestic", "foreign", "node"] as const;
        const pages = storedPages<MosdnsCachePage>(instance, allowed);
        const activePage = storedPage<MosdnsCachePage>(instance, allowed, pages[0]);
        return <MosdnsCacheStatsWidget size={size} pages={pages} activePage={activePage} showNavigation={false} />;
      }
      case "mosdns-cache-all": return <MosdnsCacheStatsWidget size={size} pages={["all"]} activePage="all" />;
      case "mosdns-cache-domestic": return <MosdnsCacheStatsWidget size={size} pages={["domestic"]} activePage="domestic" />;
      case "mosdns-cache-foreign": return <MosdnsCacheStatsWidget size={size} pages={["foreign"]} activePage="foreign" />;
      case "mosdns-cache-node": return <MosdnsCacheStatsWidget size={size} pages={["node"]} activePage="node" />;
      case "mosdns-runtime": {
        const activePage = storedPage<MosdnsRuntimePage>(instance, ["overview", "memory", "system"], "overview");
        return <MosdnsRuntimeWidget size={size} activePage={activePage} onActivePageChange={(next) => updateInstanceSettings(instance, { activePage: next })} />;
      }
      case "mosdns-resolution-policy": return <MosdnsResolutionPolicyWidget size={size} />;
      case "mosdns-cache-system": {
        const activePage = storedPage<MosdnsCacheSystemPage>(instance, ["stats", "strategy", "task", "operations"], "stats");
        return <MosdnsCacheSystemWidget size={size} activePage={activePage} onActivePageChange={(next) => updateInstanceSettings(instance, { activePage: next })} />;
      }
      case "mihomo-service": return <MihomoServiceWidget />;
      case "mihomo-traffic": return <MihomoTrafficWidget size={standardSize} />;
      case "mihomo-latency": return <MihomoLatencyWidget size={standardSize} />;
      case "mihomo-provider-traffic": return <MihomoProviderTrafficWidget size={standardSize} />;
      case "mihomo-connection-stats": return <MihomoConnectionStatsWidget size={standardSize} />;
      case "mihomo-rule-hits": return <MihomoRuleHitsWidget size={standardSize} />;
      case "mihomo-globe": return <ConnectedGlobeWidget size={size === "l" ? "l" : "m"} editing={editing} />;
      case "mihomo-topology": return <ConnectedTopologyWidget size={size === "l" ? "l" : "m"} editing={editing} />;
      case "mihomo-proxy-group": {
        const groupKey = typeof instance.settings?.groupKey === "string" ? instance.settings.groupKey : undefined;
        return <MihomoProxyGroupWidget groupKey={groupKey} onGroupKeyChange={(next) => updateInstanceSettings(instance, { groupKey: next })} showGroupSelector={false} size={standardSize} />;
      }
      default: return <MissingWidget type={instance.type} />;
    }
  };

  const renderWidgetHeader = (instance: DashboardWidgetInstance, _size: DashboardRenderSize) => {
    if (instance.type === "system-info") {
      const allowed = ["device", "hardware", "stats"] as const;
      const pages = storedPages<SystemInfoPage>(instance, allowed);
      const activePage = storedPage<SystemInfoPage>(instance, allowed, pages[0]);
      return <DashboardCollectionHeaderControl options={SYSTEM_INFO_OPTIONS} selected={pages} active={activePage} onActiveChange={(next) => updateInstanceSettings(instance, { activePage: next })} onSelectedChange={(next) => updateInstanceSettings(instance, { pages: next, activePage: next.includes(activePage) ? activePage : next[0] })} ariaLabel="系统信息页面" />;
    }
    if (instance.type === "mosdns-info") {
      const allowed = ["split", "domains", "slowest", "clients"] as const;
      const pages = storedPages<MosdnsInfoPage>(instance, allowed);
      const activePage = storedPage<MosdnsInfoPage>(instance, allowed, pages[0]);
      return <DashboardCollectionHeaderControl options={MOSDNS_INFO_OPTIONS} selected={pages} active={activePage} onActiveChange={(next) => updateInstanceSettings(instance, { activePage: next })} onSelectedChange={(next) => updateInstanceSettings(instance, { pages: next, activePage: next.includes(activePage) ? activePage : next[0] })} ariaLabel="MosDNS 信息页面" />;
    }
    if (instance.type === "mosdns-cache-stats") {
      const allowed = ["all", "domestic", "foreign", "node"] as const;
      const pages = storedPages<MosdnsCachePage>(instance, allowed);
      const activePage = storedPage<MosdnsCachePage>(instance, allowed, pages[0]);
      return <DashboardCollectionHeaderControl options={MOSDNS_CACHE_OPTIONS} selected={pages} active={activePage} onActiveChange={(next) => updateInstanceSettings(instance, { activePage: next })} onSelectedChange={(next) => updateInstanceSettings(instance, { pages: next, activePage: next.includes(activePage) ? activePage : next[0] })} ariaLabel="缓存类型" />;
    }
    if (instance.type === "mihomo-proxy-group") {
      const groupKey = typeof instance.settings?.groupKey === "string" ? instance.settings.groupKey : undefined;
      return <MihomoProxyGroupSelector groupKey={groupKey} onGroupKeyChange={(next) => updateInstanceSettings(instance, { groupKey: next })} />;
    }
    return null;
  };

  const grid = <DashboardGrid settings={settings} editing={editing} onChange={applySettings} onInteractionStart={rememberLayoutInteraction} renderWidget={renderWidget} renderWidgetHeader={renderWidgetHeader} />;
  const content = settings.instances.some((instance) => instance.type === "mihomo-proxy-group")
    ? <DashboardProxyRuntimeProvider>{grid}</DashboardProxyRuntimeProvider>
    : grid;

  return (
    <DashboardDataProvider>
      <MosdnsDashboardProvider>
        <MihomoDashboardProvider enabledScopes={mihomoScopes} connectionHistoryRequested={connectionHistoryRequested}>
          {content}
        </MihomoDashboardProvider>
      </MosdnsDashboardProvider>
    </DashboardDataProvider>
  );
}
