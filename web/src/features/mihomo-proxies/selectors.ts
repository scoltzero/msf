import { compileSafeSearch, type SafeSearchOptions } from "./search";
import { mergeStableOrder, sortByStableOrder } from "./ordering";
import {
  isProxyGroup,
  type ProxyChain,
  type ProxyEntity,
  type ProxyKey,
  type ProxyPageSettings,
  type ProxySearchMode,
  type ProxySearchResult,
  type ProxySortMode,
  type ProxyStore,
} from "./types";

function entitiesOf(source: ProxyStore | Record<ProxyKey, ProxyEntity>): Record<ProxyKey, ProxyEntity> {
  return "entities" in source ? source.entities : source;
}

export function selectGroups(store: ProxyStore): ProxyEntity[] {
  return store.groupKeys.map((key) => store.entities[key]).filter((entity): entity is ProxyEntity => Boolean(entity && entity.kind === "group"));
}

export function selectNodes(store: ProxyStore): ProxyEntity[] {
  return Object.values(store.entities).filter((entity) => entity.kind === "node");
}

export function selectGroupNodes(store: ProxyStore, groupKey: ProxyKey, includeGroups = false): ProxyEntity[] {
  const group = store.entities[groupKey];
  if (!group || group.kind !== "group") return [];
  return group.memberKeys
    .map((key) => store.entities[key])
    .filter((entity): entity is ProxyEntity => Boolean(entity && (includeGroups || entity.kind === "node")));
}

export function selectProxyByKey(store: ProxyStore, key: ProxyKey | undefined): ProxyEntity | undefined {
  return key ? store.entities[key] : undefined;
}

export function proxyDelay(entity: ProxyEntity | undefined): number {
  if (!entity) return 0;
  if (entity.delay && entity.delay > 0) return entity.delay;
  const samples = entity.history.filter((sample) => sample.delay > 0);
  return samples.length ? samples[samples.length - 1].delay : 0;
}

export function groupDelay(store: ProxyStore, group: ProxyEntity): number {
  const selected = group.selectedKey ? store.entities[group.selectedKey] : undefined;
  const selectedDelay = proxyDelay(selected);
  if (selectedDelay > 0) return selectedDelay;
  const ownDelay = proxyDelay(group);
  if (ownDelay > 0) return ownDelay;
  const delays = group.memberKeys.map((key) => proxyDelay(store.entities[key])).filter((delay) => delay > 0);
  return delays.length ? Math.min(...delays) : 0;
}

function compareEntities(store: ProxyStore, mode: ProxySortMode) {
  return (left: ProxyEntity, right: ProxyEntity): number => {
    switch (mode) {
      case "name-asc":
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      case "name-desc":
        return right.name.localeCompare(left.name, undefined, { sensitivity: "base" });
      case "type":
        return left.type.localeCompare(right.type) || left.name.localeCompare(right.name);
      case "delay-asc":
        return groupDelay(store, left) - groupDelay(store, right) || left.name.localeCompare(right.name);
      case "delay-desc":
        return groupDelay(store, right) - groupDelay(store, left) || left.name.localeCompare(right.name);
      default:
        return (left.configOrder ?? left.order ?? Number.MAX_SAFE_INTEGER) - (right.configOrder ?? right.order ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name);
    }
  };
}

export function sortProxyGroups(store: ProxyStore, groups: readonly ProxyEntity[], mode: ProxySortMode = "default", localOrder: readonly string[] = []): ProxyEntity[] {
  const sorted = [...groups].sort(compareEntities(store, mode));
  if (mode !== "default" || localOrder.length === 0) return sorted;
  const order = mergeStableOrder(sorted.map((group) => group.key), localOrder, sorted.map((group) => group.key));
  return sortByStableOrder(sorted, (group) => group.key, order);
}

export function sortProxyNodes(store: ProxyStore, nodes: readonly ProxyEntity[], mode: ProxySortMode = "default"): ProxyEntity[] {
  if (mode === "default") return [...nodes];
  return [...nodes].sort(compareEntities(store, mode));
}

function searchableText(entity: ProxyEntity, store: ProxyStore): string {
  const selected = entity.selectedKey ? store.entities[entity.selectedKey]?.name : "";
  return [entity.name, entity.type, selected, entity.providerName].filter(Boolean).join(" ");
}

export function searchProxyStore(
  store: ProxyStore,
  query: string,
  mode: ProxySearchMode = "groups",
  options: SafeSearchOptions = {},
): { results: ProxySearchResult[]; error?: string } {
  const matcher = compileSafeSearch(query, options);
  if (!matcher.valid) return { results: [], error: matcher.error };
  if (!query.trim()) {
    if (mode === "groups") return { results: selectGroups(store).map((entity) => ({ key: entity.key, entity })) };
    return { results: selectNodes(store).map((entity) => ({ key: entity.key, providerName: entity.providerName, entity })) };
  }
  if (mode === "groups") {
    return {
      results: selectGroups(store)
        .filter((entity) => matcher.test(searchableText(entity, store)))
        .map((entity) => ({ key: entity.key, entity })),
    };
  }
  const results: ProxySearchResult[] = [];
  const groups = selectGroups(store);
  for (const entity of selectNodes(store)) {
    if (!matcher.test([entity.name, entity.type, entity.providerName].filter(Boolean).join(" "))) continue;
    const owners = groups.filter((group) => group.memberKeys.includes(entity.key));
    if (owners.length === 0) results.push({ key: entity.key, providerName: entity.providerName, entity });
    else owners.forEach((group) => results.push({ key: entity.key, groupKey: group.key, providerName: entity.providerName, entity }));
  }
  return { results };
}

export const searchProxyEntities = searchProxyStore;

export function selectVisibleGroups(store: ProxyStore, settings: Pick<ProxyPageSettings, "showHiddenProxies" | "hiddenGroups" | "hideUnavailable" | "sortBy" | "groupOrder">, query = "", options: SafeSearchOptions = {}): { groups: ProxyEntity[]; error?: string } {
  const matched = searchProxyStore(store, query, "groups", options);
  const matching = new Set(matched.results.map((result) => result.key));
  const filtered = selectGroups(store).filter((group) => {
    if (!settings.showHiddenProxies && (group.hidden || settings.hiddenGroups.includes(group.name))) return false;
    if (settings.hideUnavailable && !group.alive) return false;
    return !query.trim() || matching.has(group.key);
  });
  return { groups: sortProxyGroups(store, filtered, settings.sortBy, settings.groupOrder), error: matched.error };
}

export function selectVisibleNodes(
  store: ProxyStore,
  groupKey: ProxyKey,
  settings: Pick<ProxyPageSettings, "showHiddenProxies" | "hideUnavailable" | "sortBy">,
  query = "",
  options: SafeSearchOptions = {},
): { nodes: ProxyEntity[]; error?: string } {
  const matcher = compileSafeSearch(query, options);
  if (!matcher.valid) return { nodes: [], error: matcher.error };
  const nodes = sortProxyNodes(
    store,
    selectGroupNodes(store, groupKey).filter((node) => {
      if (!settings.showHiddenProxies && node.hidden) return false;
      if (settings.hideUnavailable && !node.alive) return false;
      return !query.trim() || matcher.test([node.name, node.type, node.providerName].filter(Boolean).join(" "));
    }),
    settings.sortBy,
  );
  return { nodes };
}

/** Resolve selected nested groups while protecting the selector from cycles. */
export function resolveProxyChain(groupKey: ProxyKey, source: ProxyStore | Record<ProxyKey, ProxyEntity>, maxDepth = 32): ProxyChain {
  const entities = entitiesOf(source);
  const path: ProxyKey[] = [];
  const visited = new Set<ProxyKey>();
  let current: ProxyKey | undefined = groupKey;
  let finalKey: ProxyKey | undefined;
  let missingKey: ProxyKey | undefined;
  let cycleDetected = false;
  let maxDepthReached = false;
  while (current) {
    if (path.length >= maxDepth) {
      maxDepthReached = true;
      break;
    }
    if (visited.has(current)) {
      cycleDetected = true;
      break;
    }
    const entity: ProxyEntity | undefined = entities[current];
    if (!entity) {
      missingKey = current;
      break;
    }
    visited.add(current);
    path.push(current);
    if (entity.kind === "node") {
      finalKey = current;
      break;
    }
    const next: ProxyKey | undefined = entity.selectedKey;
    if (!next) break;
    current = next;
  }
  return { path, finalKey, cycleDetected, missingKey, maxDepthReached };
}

export const resolveFinalProxy = resolveProxyChain;

export function selectProviderNodes(store: ProxyStore, providerId: string): ProxyEntity[] {
  const provider = store.providers[providerId];
  return provider ? provider.proxyKeys.map((key) => store.entities[key]).filter((entity): entity is ProxyEntity => Boolean(entity)) : [];
}
