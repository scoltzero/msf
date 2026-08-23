"use client";

import { createContext, useContext } from "react";
import type { ProxyRuntime } from "@/features/mihomo-proxies/useProxyRuntime";

export const DashboardProxyRuntimeContext = createContext<ProxyRuntime | null>(null);

export function useDashboardProxyRuntime(): ProxyRuntime {
  const context = useContext(DashboardProxyRuntimeContext);
  if (!context) throw new Error("useDashboardProxyRuntime 必须在 DashboardProxyRuntimeProvider 内使用");
  return context;
}
