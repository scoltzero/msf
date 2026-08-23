import {
  DEFAULT_PROXY_TEST_URL,
  DEFAULT_PROXY_TIMEOUT_MS,
  type ProxyDelaySample,
  type ProxyEntity,
  type ProxyKey,
  type ProxyStore,
  type ProxyStoreAction,
} from "./types";

export const EMPTY_PROXY_STORE: ProxyStore = {
  entities: {},
  groupKeys: [],
  providers: {},
  providerIds: [],
  fetchedAt: 0,
  stats: {
    connections: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    uploadTotal: 0,
    downloadTotal: 0,
    mode: "-",
  },
  authority: {
    mode: "unknown",
    isDefault: false,
    activePath: "",
    activeName: "",
    runtimePath: "configs/mihomo/config.yaml",
    canEditGroups: false,
    canEditProviders: true,
    canEditManualNodes: true,
  },
  pageTestPolicy: {
    url: DEFAULT_PROXY_TEST_URL,
    timeoutMs: DEFAULT_PROXY_TIMEOUT_MS,
    source: "page-fallback",
    persisted: false,
  },
  groupPolicies: {},
};

export function createEmptyProxyStore(): ProxyStore {
  return {
    ...EMPTY_PROXY_STORE,
    entities: {},
    providers: {},
    providerIds: [],
    groupKeys: [],
    groupPolicies: {},
    stats: { ...EMPTY_PROXY_STORE.stats },
    authority: { ...EMPTY_PROXY_STORE.authority },
    pageTestPolicy: EMPTY_PROXY_STORE.pageTestPolicy ? { ...EMPTY_PROXY_STORE.pageTestPolicy } : undefined,
  };
}

function appendSample(entity: ProxyEntity, delay: number, sample?: ProxyDelaySample): ProxyDelaySample[] {
  const next = sample ?? { delay, timestamp: new Date().toISOString() };
  const history = [...entity.history, { ...next, delay }];
  // Mihomo history is short by design; retaining the latest 20 samples keeps
  // charts useful without allowing repeated refreshes to grow memory forever.
  return history.slice(-20);
}

function sampleAt(sample: ProxyDelaySample | undefined): number | undefined {
  if (!sample?.timestamp) return undefined;
  const parsed = Date.parse(sample.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Keep a locally sampled delay when a refresh returns an older/partial row. */
function preserveLocalDelay(previous: ProxyEntity | undefined, next: ProxyEntity): ProxyEntity {
  if (!previous) return next;
  const previousSample = previous.history.at(-1);
  // Runtime test writes carry url + success; this distinguishes local samples
  // from ordinary controller snapshots while remaining backward-compatible.
  if (!previousSample?.url || typeof previousSample.success !== "boolean") return next;
  const previousAt = sampleAt(previousSample);
  const nextAt = sampleAt(next.history.at(-1));
  if (nextAt !== undefined && previousAt !== undefined && nextAt > previousAt) return next;
  return { ...next, delay: previous.delay, alive: previous.alive, history: previous.history };
}

export function patchProxyDelay(store: ProxyStore, key: ProxyKey, delay: number, sample?: ProxyDelaySample): ProxyStore {
  const current = store.entities[key];
  if (!current) return store;
  const nextEntity: ProxyEntity = {
    ...current,
    delay,
    alive: delay > 0 || current.type.toLowerCase() === "direct" || current.kind === "group",
    history: appendSample(current, delay, sample),
  };
  return {
    ...store,
    entities: { ...store.entities, [key]: nextEntity },
  };
}

/** Patch one sampled result onto every rendered attribution key atomically. */
export function patchProxyDelayKeys(
  store: ProxyStore,
  keys: readonly ProxyKey[],
  delay: number,
  sample?: ProxyDelaySample,
): ProxyStore {
  const unique = Array.from(new Set(keys));
  if (unique.length === 0) return store;
  let next = store;
  for (const key of unique) next = patchProxyDelay(next, key, delay, sample);
  return next;
}

export function patchProxySelection(store: ProxyStore, groupKey: ProxyKey, selectedKey?: ProxyKey): ProxyStore {
  const group = store.entities[groupKey];
  if (!group || group.kind !== "group" || group.selectedKey === selectedKey) return store;
  return {
    ...store,
    entities: { ...store.entities, [groupKey]: { ...group, selectedKey } },
  };
}

export function mergeProxyStore(previous: ProxyStore, next: ProxyStore): ProxyStore {
  // The normalizer already performs entity-level structural sharing.  This
  // helper preserves the previous successful snapshot when a partial request
  // omitted a section (for example a temporarily unavailable providers API).
  const entities = Object.keys(next.entities).length
    ? Object.fromEntries(Object.entries(next.entities).map(([key, entity]) => [key, preserveLocalDelay(previous.entities[key as ProxyKey], entity)])) as ProxyStore["entities"]
    : previous.entities;
  const groupKeys = next.groupKeys.length ? next.groupKeys : previous.groupKeys;
  const providers = Object.keys(next.providers).length ? next.providers : previous.providers;
  const providerIds = next.providerIds.length ? next.providerIds : previous.providerIds;
  return {
    ...next,
    entities,
    groupKeys,
    providers,
    providerIds,
    stats: next.stats ?? previous.stats,
    authority: next.authority ?? previous.authority,
    pageTestPolicy: next.pageTestPolicy ?? previous.pageTestPolicy,
    groupPolicies: Object.keys(next.groupPolicies).length ? next.groupPolicies : previous.groupPolicies,
  };
}

export function proxyStoreReducer(store: ProxyStore, action: ProxyStoreAction): ProxyStore {
  switch (action.type) {
    case "replace":
      return action.store;
    case "merge":
      return mergeProxyStore(store, action.store);
    case "patch-delay":
      return patchProxyDelay(store, action.key, action.delay, action.sample);
    case "patch-selected":
      return patchProxySelection(store, action.groupKey, action.selectedKey);
    case "clear":
      return createEmptyProxyStore();
    default:
      return store;
  }
}
