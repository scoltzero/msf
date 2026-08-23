"use client";

import { createContext, useContext, useEffect } from "react";
import type { CacheDomainRow, CacheSystemData, ResolutionSettings, RunMode, ScheduledTask } from "@/lib/mosdns-system-data";

export type MosdnsDataScope = "overview" | "query" | "control";

export interface MosdnsDashboardData {
  overview: Record<string, any>;
  queryEntries: any[];
  loading: boolean;
  error: string;
  message: string;
  runMode: RunMode;
  resolutionSettings: ResolutionSettings;
  prioritySaving: boolean;
  cacheData: CacheSystemData;
  cacheDomains: Partial<Record<"realIp" | "fakeIp" | "noV4" | "noV6", CacheDomainRow[]>>;
  actionSaving: boolean;
  refreshOverview: () => Promise<void>;
  refreshControl: () => Promise<void>;
  changeRunMode: (mode: RunMode) => Promise<void>;
  changePriority: (priority: "auto" | "ipv4" | "ipv6") => Promise<void>;
  toggleCacheStrategy: (key: "expiredCache1" | "expiredCache2") => Promise<void>;
  changeScheduledTask: (task: ScheduledTask) => void;
  saveScheduledTask: () => Promise<void>;
  runCacheAction: (action: "start" | "save" | "clear") => Promise<void>;
  clearDNSCache: () => Promise<void>;
  registerScope: (scope: MosdnsDataScope, delta: 1 | -1) => void;
}

export const MosdnsDashboardDataContext = createContext<MosdnsDashboardData | null>(null);

export function useMosdnsDashboardData(scopes: MosdnsDataScope[] = ["overview"]) {
  const context = useContext(MosdnsDashboardDataContext);
  if (!context) throw new Error("useMosdnsDashboardData must be used inside MosdnsDashboardProvider");
  const scopeKey = [...new Set(scopes)].sort().join(",");
  useEffect(() => {
    const active = scopeKey ? scopeKey.split(",") as MosdnsDataScope[] : [];
    active.forEach((scope) => context.registerScope(scope, 1));
    return () => active.forEach((scope) => context.registerScope(scope, -1));
  }, [context.registerScope, scopeKey]);
  return context;
}
