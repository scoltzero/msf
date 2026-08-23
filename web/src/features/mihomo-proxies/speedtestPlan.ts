import { resolveNodeTestPolicy, type ProxyPolicySource } from "./latency";
import type { ProxyEntity, ProxyKey, ProxyProvider, ProxyStore, ProxyTestPolicy } from "./types";

/** Mihomo's synthetic entries are not physical proxies and must never fail a test job. */
const BUILTIN_PROXY_NAMES = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE"]);

export type ProxySpeedtestSkipReason = "builtin" | "no-final-exit" | "cycle" | "missing";

/** Attribution shared by executable and skipped plan entries. */
type ProxySpeedtestAttribution = {
  /** Canonical physical leaf key. Kept alongside `key` for old callers. */
  physicalKey: ProxyKey;
  /** Keys whose rendered cards should receive the result. */
  displayKeys: ProxyKey[];
  /** Root-to-leaf (or root-to-missing) traversal path. */
  path: ProxyKey[];
};

export type ProxySpeedtestTarget = ProxySpeedtestAttribution & {
  /** Backwards-compatible alias for physicalKey. */
  key: ProxyKey;
  node: ProxyEntity;
  provider?: ProxyProvider;
  /** The nearest configured group whose policy applies to this leaf, when any. */
  groupKey?: ProxyKey;
  policy: ProxyTestPolicy;
};

export type ProxySpeedtestSkippedTarget = Partial<ProxySpeedtestAttribution> & {
  /** Backwards-compatible key for callers that render skipped entries. */
  key?: ProxyKey;
  node?: ProxyEntity;
  provider?: ProxyProvider;
  groupKey?: ProxyKey;
  policy?: ProxyTestPolicy;
  skipped: true;
  reason: ProxySpeedtestSkipReason;
};

export type ProxySpeedtestPlan = {
  /** Executable physical targets only; skipped entries are never counted as failures. */
  targets: ProxySpeedtestTarget[];
  /** Built-ins and unresolved current exits, retained for diagnostics/UI attribution. */
  skippedTargets: ProxySpeedtestSkippedTarget[];
  /** Alias for consumers that use the shorter terminology. */
  skipped: ProxySpeedtestSkippedTarget[];
  /** A cycle is reported as the path up to and including its repeated key. */
  cycles: ProxyKey[][];
  missingKeys: ProxyKey[];
};

export type ProxySpeedtestPlanOptions = {
  temporary?: ProxyPolicySource;
  pageFallback?: ProxyPolicySource;
  systemDefault?: ProxyPolicySource;
  /** Parent group for a node rendered inside a group card. */
  groupKey?: ProxyKey;
};

type ExitResolution = {
  path: ProxyKey[];
  finalKey?: ProxyKey;
  cycle?: ProxyKey[];
  missingKey?: ProxyKey;
};

type PlanBuilder = {
  targets: Map<ProxyKey, ProxySpeedtestTarget>;
  skipped: Map<string, ProxySpeedtestSkippedTarget>;
  cycles: ProxyKey[][];
  cycleKeys: Set<string>;
  missingKeys: ProxyKey[];
  missingSet: Set<ProxyKey>;
};

export function isExcludedProxyNode(entity: ProxyEntity | undefined): boolean {
  if (!entity || entity.kind !== "node") return false;
  const name = entity.name.trim().toUpperCase();
  const type = entity.type.trim().toUpperCase();
  return BUILTIN_PROXY_NAMES.has(name) || BUILTIN_PROXY_NAMES.has(type);
}

/** Resolve a provider by id/name, falling back to its canonical proxy key list. */
export function providerForNode(store: ProxyStore, node: ProxyEntity): ProxyProvider | undefined {
  if (node.providerName) {
    const direct = store.providers[node.providerName];
    if (direct) return direct;
    const byName = Object.values(store.providers).find((provider) => provider.name === node.providerName);
    if (byName) return byName;
  }
  // Some controller snapshots omit provider_name even though the provider
  // proxy list still carries the composite key.
  return Object.values(store.providers).find((provider) => provider.proxyKeys.includes(node.key));
}

function uniqueKeys(keys: readonly ProxyKey[]): ProxyKey[] {
  return Array.from(new Set(keys));
}

function createBuilder(): PlanBuilder {
  return {
    targets: new Map(),
    skipped: new Map(),
    cycles: [],
    cycleKeys: new Set(),
    missingKeys: [],
    missingSet: new Set(),
  };
}

function addMissing(builder: PlanBuilder, key: ProxyKey): void {
  if (!builder.missingSet.has(key)) {
    builder.missingSet.add(key);
    builder.missingKeys.push(key);
  }
}

function addCycle(builder: PlanBuilder, cycle: ProxyKey[]): void {
  if (cycle.length === 0) return;
  const cycleKey = cycle.join("\u0000");
  if (!builder.cycleKeys.has(cycleKey)) {
    builder.cycleKeys.add(cycleKey);
    builder.cycles.push(cycle);
  }
}

function skippedKey(entry: ProxySpeedtestSkippedTarget): string {
  return `${entry.key ?? ""}\u0000${entry.reason}`;
}

function addSkipped(builder: PlanBuilder, entry: ProxySpeedtestSkippedTarget): void {
  const key = skippedKey(entry);
  const existing = builder.skipped.get(key);
  if (!existing) {
    builder.skipped.set(key, {
      ...entry,
      ...(entry.displayKeys ? { displayKeys: uniqueKeys(entry.displayKeys) } : {}),
      ...(entry.path ? { path: [...entry.path] } : {}),
    });
    return;
  }
  existing.displayKeys = uniqueKeys([...(existing.displayKeys ?? []), ...(entry.displayKeys ?? [])]);
  if (entry.path && (!existing.path || existing.path.length < entry.path.length)) existing.path = [...entry.path];
}

function addTarget(builder: PlanBuilder, target: ProxySpeedtestTarget): void {
  const existing = builder.targets.get(target.physicalKey);
  if (!existing) {
    builder.targets.set(target.physicalKey, {
      ...target,
      key: target.physicalKey,
      displayKeys: uniqueKeys(target.displayKeys),
      path: [...target.path],
    });
    return;
  }
  // The first target wins policy/path (groupKeys are stable config order), but
  // every visible attribution key is retained so one result updates all cards.
  existing.displayKeys = uniqueKeys([...existing.displayKeys, ...target.displayKeys]);
}

function buildPlan(builder: PlanBuilder): ProxySpeedtestPlan {
  const skippedTargets = Array.from(builder.skipped.values());
  return {
    targets: Array.from(builder.targets.values()),
    skippedTargets,
    skipped: skippedTargets,
    cycles: builder.cycles,
    missingKeys: builder.missingKeys,
  };
}

/** Follow current `selectedKey` links only; never expand all descendant members. */
export function resolveCurrentPhysicalExit(store: ProxyStore, rootKey: ProxyKey, maxDepth = 32): ExitResolution {
  const path: ProxyKey[] = [];
  const positions = new Map<ProxyKey, number>();
  let current: ProxyKey | undefined = rootKey;
  while (current) {
    const repeatedAt = positions.get(current);
    if (repeatedAt !== undefined) {
      return { path, cycle: [...path.slice(repeatedAt), current] };
    }
    if (path.length >= maxDepth) return { path };
    const entity: ProxyEntity | undefined = store.entities[current];
    if (!entity) return { path, missingKey: current };
    positions.set(current, path.length);
    path.push(current);
    if (entity.kind === "node") return { path, finalKey: current };
    current = entity.selectedKey;
  }
  return { path };
}

function nearestConfiguredGroup(store: ProxyStore, path: readonly ProxyKey[]): ProxyEntity | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entity = store.entities[path[index]];
    if (entity?.kind === "group" && entity.testPolicy) return entity;
  }
  return undefined;
}

function policyForPath(
  store: ProxyStore,
  node: ProxyEntity,
  path: readonly ProxyKey[],
  options: ProxySpeedtestPlanOptions,
): { policy: ProxyTestPolicy; group?: ProxyEntity; provider?: ProxyProvider } {
  const provider = providerForNode(store, node);
  const group = nearestConfiguredGroup(store, path);
  const policy = resolveNodeTestPolicy(
    node,
    group,
    provider,
    options.pageFallback ?? store.pageTestPolicy,
    options.systemDefault,
    options.temporary,
  );
  return { policy, group, provider };
}

function addPhysicalTarget(
  builder: PlanBuilder,
  store: ProxyStore,
  node: ProxyEntity,
  path: ProxyKey[],
  displayKeys: ProxyKey[],
  options: ProxySpeedtestPlanOptions,
): void {
  if (isExcludedProxyNode(node)) {
    addSkipped(builder, {
      key: node.key,
      physicalKey: node.key,
      node,
      displayKeys,
      path,
      skipped: true,
      reason: "builtin",
    });
    return;
  }
  const attribution = policyForPath(store, node, path, options);
  addTarget(builder, {
    key: node.key,
    physicalKey: node.key,
    node,
    provider: attribution.provider,
    groupKey: attribution.group?.key,
    displayKeys,
    path,
    policy: attribution.policy,
  });
}

function addExitForMember(
  builder: PlanBuilder,
  store: ProxyStore,
  rootGroupKey: ProxyKey,
  memberKey: ProxyKey,
  options: ProxySpeedtestPlanOptions,
): void {
  const member = store.entities[memberKey];
  const memberPath = [rootGroupKey, memberKey];
  if (!member) {
    addMissing(builder, memberKey);
    addSkipped(builder, { key: memberKey, displayKeys: [memberKey], path: memberPath, skipped: true, reason: "missing" });
    return;
  }
  if (member.kind === "node") {
    addPhysicalTarget(builder, store, member, memberPath, [member.key], options);
    return;
  }

  const exit = resolveCurrentPhysicalExit(store, memberKey);
  const path = [rootGroupKey, ...exit.path];
  if (exit.cycle) {
    addCycle(builder, exit.cycle);
    addSkipped(builder, { key: memberKey, displayKeys: [memberKey], path, skipped: true, reason: "cycle" });
    return;
  }
  if (exit.missingKey) {
    addMissing(builder, exit.missingKey);
    addSkipped(builder, { key: memberKey, displayKeys: [memberKey], path, skipped: true, reason: "missing" });
    return;
  }
  if (!exit.finalKey) {
    addSkipped(builder, { key: memberKey, displayKeys: [memberKey], path, skipped: true, reason: "no-final-exit" });
    return;
  }
  const node = store.entities[exit.finalKey];
  if (!node || node.kind !== "node") {
    addMissing(builder, exit.finalKey);
    addSkipped(builder, { key: memberKey, displayKeys: [memberKey], path, skipped: true, reason: "missing" });
    return;
  }
  addPhysicalTarget(
    builder,
    store,
    node,
    path,
    uniqueKeys([memberKey, ...path.filter((key) => key !== rootGroupKey && store.entities[key]?.kind === "group"), node.key]),
    options,
  );
}

function addGroupMembers(builder: PlanBuilder, store: ProxyStore, groupKey: ProxyKey, options: ProxySpeedtestPlanOptions): void {
  const group = store.entities[groupKey];
  if (!group) {
    addMissing(builder, groupKey);
    addSkipped(builder, { key: groupKey, displayKeys: [groupKey], path: [groupKey], skipped: true, reason: "missing" });
    return;
  }
  if (group.kind !== "group") {
    addPhysicalTarget(builder, store, group, [groupKey], [groupKey], options);
    return;
  }
  // Deliberately one level: a nested group contributes its current selected
  // physical exit, never every descendant leaf.
  group.memberKeys.forEach((memberKey) => addExitForMember(builder, store, groupKey, memberKey, options));
}

/** Plan a single node card. A nested group card resolves only its current exit. */
export function planProxyNodeTest(store: ProxyStore, key: ProxyKey, options: ProxySpeedtestPlanOptions = {}): ProxySpeedtestPlan {
  const builder = createBuilder();
  const entity = store.entities[key];
  if (!entity) {
    addMissing(builder, key);
    addSkipped(builder, { key, displayKeys: [key], path: [key], skipped: true, reason: "missing" });
    return buildPlan(builder);
  }
  if (entity.kind === "node") {
    const path = options.groupKey && options.groupKey !== key ? [options.groupKey, key] : [key];
    addPhysicalTarget(builder, store, entity, path, [key], options);
    return buildPlan(builder);
  }
  const exit = resolveCurrentPhysicalExit(store, key);
  const path = options.groupKey && options.groupKey !== key ? [options.groupKey, ...exit.path] : exit.path;
  if (exit.cycle) {
    addCycle(builder, exit.cycle);
    addSkipped(builder, { key, displayKeys: [key], path, skipped: true, reason: "cycle" });
    return buildPlan(builder);
  }
  if (exit.missingKey) {
    addMissing(builder, exit.missingKey);
    addSkipped(builder, { key, displayKeys: [key], path, skipped: true, reason: "missing" });
    return buildPlan(builder);
  }
  if (!exit.finalKey) {
    addSkipped(builder, { key, displayKeys: [key], path, skipped: true, reason: "no-final-exit" });
    return buildPlan(builder);
  }
  const node = store.entities[exit.finalKey];
  if (!node || node.kind !== "node") {
    addMissing(builder, exit.finalKey);
    addSkipped(builder, { key, displayKeys: [key], path, skipped: true, reason: "missing" });
    return buildPlan(builder);
  }
  addPhysicalTarget(
    builder,
    store,
    node,
    path,
    uniqueKeys([key, ...path.filter((item) => item !== options.groupKey && store.entities[item]?.kind === "group"), node.key]),
    options,
  );
  return buildPlan(builder);
}

/** Plan one strategy group using only direct members and their current exits. */
export function planProxyGroupTests(store: ProxyStore, groupKey: ProxyKey, options: ProxySpeedtestPlanOptions = {}): ProxySpeedtestPlan {
  const builder = createBuilder();
  addGroupMembers(builder, store, groupKey, options);
  return buildPlan(builder);
}

/**
 * Plan every unique physical node exposed by provider and custom sources.
 * Group direct members are visited first so an applicable group policy wins;
 * provider/custom roots then fill in every physical node not currently selected.
 */
export function planAllProxyTests(store: ProxyStore, options: ProxySpeedtestPlanOptions = {}): ProxySpeedtestPlan {
  const builder = createBuilder();
  store.groupKeys.forEach((groupKey) => addGroupMembers(builder, store, groupKey, options));
  for (const providerId of uniqueProviderIds(store)) {
    for (const key of store.providers[providerId]?.proxyKeys ?? []) {
      const node = store.entities[key];
      if (node?.kind === "node") addPhysicalTarget(builder, store, node, [key], [key], options);
      else if (!node) {
        addMissing(builder, key);
        addSkipped(builder, { key, displayKeys: [key], path: [key], skipped: true, reason: "missing" });
      }
    }
  }
  for (const [key, entity] of Object.entries(store.entities) as Array<[ProxyKey, ProxyEntity]>) {
    if (entity.kind === "node") addPhysicalTarget(builder, store, entity, [key], [key], options);
  }
  return buildPlan(builder);
}

function uniqueProviderIds(store: ProxyStore): string[] {
  return Array.from(new Set([...store.providerIds, ...Object.keys(store.providers)]));
}
