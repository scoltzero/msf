/** Domain types used by the Mihomo proxies page.
 *
 * The controller has had a few response shapes over time.  The feature layer
 * deliberately keeps those wire details out of the UI and only exposes the
 * normalized types below.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type ProxyKey = `global:${string}` | `provider:${string}:${string}`;
export type ProxyKind = "node" | "group";

export type ProxyDelaySample = {
  delay: number;
  timestamp?: string;
  meanDelay?: number;
  success?: boolean;
  url?: string;
};

export type ProxyEntity = {
  key: ProxyKey;
  name: string;
  type: string;
  kind: ProxyKind;
  /** Group members are keys, never copied node objects. */
  memberKeys: ProxyKey[];
  selectedKey?: ProxyKey;
  providerName?: string;
  history: ProxyDelaySample[];
  alive: boolean;
  udp: boolean;
  xudp: boolean;
  hidden: boolean;
  icon?: string;
  order?: number;
  configOrder?: number;
  delay?: number;
  testPolicy?: ProxyTestPolicy;
  /** A small escape hatch for fields needed by an editor/debugger. */
  raw?: JsonObject;
};

export type ProxySubscriptionInfo = {
  upload?: number;
  download?: number;
  total?: number;
  expire?: string;
  used?: number;
  updatedAt?: string;
  [key: string]: JsonValue | undefined;
};

export type ProxyProvider = {
  id: string;
  name: string;
  proxyKeys: ProxyKey[];
  vehicleType: string;
  updatedAt?: string;
  testPolicy?: ProxyTestPolicy;
  subscription?: ProxySubscriptionInfo;
  alive?: number;
  total?: number;
  used?: number;
  quota?: number;
  percent?: number;
  raw?: JsonObject;
};

export type ProxyRuntimeStats = {
  connections: number;
  uploadSpeed: number;
  downloadSpeed: number;
  uploadTotal: number;
  downloadTotal: number;
  mode: string;
};

export type ProxyTestUrlSource =
  | "temporary"
  | "group-config"
  | "provider-config"
  | "page-fallback"
  | "system-default";

export type ProxyTestPolicy = {
  url: string;
  timeoutMs: number;
  source: ProxyTestUrlSource;
  sourceName?: string;
  persisted: boolean;
};

export type ProxyTestJobScope = "node" | "group" | "provider" | "all";
export type ProxyTestJobStatus = "queued" | "running" | "done" | "cancelled";

export type ProxyTestJob = {
  id: string;
  scope: ProxyTestJobScope;
  status: ProxyTestJobStatus;
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

export type ProxyGroupTestPolicy = {
  url?: string;
  interval?: number;
  lazy?: boolean;
  timeoutMs?: number;
};

export type ProxyConfigAuthorityMode = "generated" | "default" | "custom" | "unknown";

export type ProxyConfigAuthority = {
  mode: ProxyConfigAuthorityMode;
  isDefault: boolean;
  activePath: string;
  activeName: string;
  runtimePath: string;
  canEditGroups: boolean;
  canEditProviders: boolean;
  canEditManualNodes: boolean;
};

export type ProxyPageSettings = {
  /** Persisted schema version. Keep this explicit so future migrations are deterministic. */
  version: 3;
  /** Group nodes by their Provider inside an expanded strategy group. */
  groupProxiesByProvider: boolean;
  hideUnavailable: boolean;
  showHiddenProxies: boolean;
  /** Allow the user-hidden strategy-group controls to be exposed in the page. */
  manageHiddenGroups: boolean;
  autoDisconnectOnSwitch: boolean;
  displayFinalOutbound: boolean;
  disableProxiesPageTextSelect: boolean;
  minProxyCardWidth: number;
  doubleColumn: boolean;
  /** Default URL only; provider/group policies take precedence. */
  delayTestUrl: string;
  delayTimeoutMs: number;
  /** Compatibility values retained for delay colour semantics; not user-facing settings. */
  delayLowMs: number;
  delayHighMs: number;
  sortBy: ProxySortMode;
  nodeNameDisplay: "truncate" | "wrap";
  displayGlobalByMode: boolean;
  proxyPreviewType: "auto" | "dots" | "bar";
  proxyCardSize: "compact" | "comfortable";
  proxyGroupIconSize: number;
  proxyGroupIconMargin: number;
  groupOrder: string[];
  hiddenGroups: string[];
};

export type ProxySortMode = "default" | "name-asc" | "name-desc" | "delay-asc" | "delay-desc" | "type";

export type ProxyStore = {
  entities: Record<ProxyKey, ProxyEntity>;
  groupKeys: ProxyKey[];
  providers: Record<string, ProxyProvider>;
  providerIds: string[];
  fetchedAt: number;
  stats: ProxyRuntimeStats;
  authority: ProxyConfigAuthority;
  pageTestPolicy?: ProxyTestPolicy;
  /** Group policy metadata returned by the API. */
  groupPolicies: Record<string, ProxyGroupTestPolicy>;
};

export type ProxyStoreAction =
  | { type: "replace"; store: ProxyStore }
  | { type: "merge"; store: ProxyStore }
  | { type: "patch-delay"; key: ProxyKey; delay: number; sample?: ProxyDelaySample }
  | { type: "patch-selected"; groupKey: ProxyKey; selectedKey?: ProxyKey }
  | { type: "clear" };

export type ProxyRuntimeSnapshot = {
  store: ProxyStore;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  visible: boolean;
  testingJobs: Record<string, ProxyTestJob>;
};

export type ProxySearchMode = "groups" | "nodes";

export type ProxySearchResult = {
  key: ProxyKey;
  groupKey?: ProxyKey;
  providerName?: string;
  entity: ProxyEntity;
};

export type ProxyChain = {
  path: ProxyKey[];
  finalKey?: ProxyKey;
  cycleDetected: boolean;
  missingKey?: ProxyKey;
  maxDepthReached?: boolean;
};

export type ProxyRawSnapshot = JsonObject;

export const DEFAULT_PROXY_TEST_URL = "https://www.gstatic.com/generate_204";
export const DEFAULT_PROXY_TIMEOUT_MS = 5_000;

export function isProxyGroup(entity: ProxyEntity | undefined): entity is ProxyEntity {
  return entity?.kind === "group";
}

export function isProxyNode(entity: ProxyEntity | undefined): entity is ProxyEntity {
  return entity?.kind === "node";
}
