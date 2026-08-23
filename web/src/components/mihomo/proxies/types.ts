import type { ProxyPageSettings } from "@/features/mihomo-proxies/types";

export type ProxyTab = "groups" | "providers";
export type ProxySearchMode = "groups" | "nodes";
export type ProxyNodeDisplay = "truncate" | "wrap";
export type ProxyPreviewType = "auto" | "dots" | "bar";
export type ProxyCardSize = "compact" | "comfortable";

export interface ProxyNodeView {
  key: string;
  name: string;
  type?: string;
  kind?: "node" | "group";
  delay?: number;
  alive?: boolean;
  hidden?: boolean;
  icon?: string;
  providerName?: string;
}

export interface ProxyGroupView {
  key: string;
  name: string;
  type: string;
  nodes: ProxyNodeView[];
  icon?: string;
  selectedKey?: string;
  selectedName?: string;
  selectedIcon?: string;
  finalOutboundKey?: string;
  finalOutboundName?: string;
  finalOutboundIcon?: string;
  finalOutboundProvider?: string;
  delay?: number;
  trafficSpeed?: number;
  hidden?: boolean;
  userHidden?: boolean;
  readOnly?: boolean;
}

export interface ProxyProviderView {
  id: string;
  name: string;
  vehicleType?: string;
  nodes: ProxyNodeView[];
  alive?: number;
  total?: number;
  used?: string;
  quota?: string;
  percent?: number;
  updated?: string;
  expire?: string;
  stale?: boolean;
}

export interface ProxyConfigStatusView {
  mode: "generated" | "custom" | string;
  isDefault?: boolean;
  activeName?: string;
  activePath?: string;
  runtimePath?: string;
  canEditGroups?: boolean;
  canEditProviders?: boolean;
  canEditManualNodes?: boolean;
}

export interface ProxyRuntimeStatsView {
  connections: number;
  uploadSpeed: string;
  downloadSpeed: string;
  uploadTotal: string;
  downloadTotal: string;
  mode: string;
}

/**
 * Settings presented by the proxy-page dialogs. Keep this as an extension of
 * the persisted domain type so the page can pass settings through without a
 * second, drifting schema. The compatibility delay thresholds remain typed for
 * existing cards, but are intentionally not rendered by the settings UI.
 */
export interface ProxySettingsView extends ProxyPageSettings {
  sortBy: ProxyPageSettings["sortBy"];
  nodeNameDisplay: ProxyNodeDisplay;
  proxyPreviewType: ProxyPreviewType;
  proxyCardSize: ProxyCardSize;
}

export interface ProxyTestProgressView {
  id?: string;
  scope: "node" | "group" | "provider" | "all";
  status: "queued" | "running" | "done" | "cancelled" | "error";
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  url?: string;
  source?: string;
  timeoutMs?: number;
}

export interface ProxyChainView {
  path: string[];
  finalKey?: string;
  cycleDetected?: boolean;
  missing?: string[];
}
