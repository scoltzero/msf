"use client";

import { useEffect, useState, type ReactNode } from "react";
import { readProxySettings } from "@/features/mihomo-proxies/settings";
import { useProxyRuntime } from "@/features/mihomo-proxies/useProxyRuntime";
import type { ProxyPageSettings } from "@/features/mihomo-proxies/types";
import { DashboardProxyRuntimeContext } from "./useDashboardProxyRuntime";

export function DashboardProxyRuntimeProvider({ children, autoRefreshMs = 30_000 }: { children: ReactNode; autoRefreshMs?: number }) {
  const [settings, setSettings] = useState<ProxyPageSettings>(() => readProxySettings());
  useEffect(() => {
    const sync = () => setSettings(readProxySettings());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const runtime = useProxyRuntime({
    enabled: true,
    autoRefreshMs,
    pageFallback: { url: settings.delayTestUrl, timeoutMs: settings.delayTimeoutMs },
    settings: { autoDisconnectOnSwitch: settings.autoDisconnectOnSwitch },
  });
  return <DashboardProxyRuntimeContext.Provider value={runtime}>{children}</DashboardProxyRuntimeContext.Provider>;
}
