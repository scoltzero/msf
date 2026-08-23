import {
  DEFAULT_PROXY_TEST_URL,
  DEFAULT_PROXY_TIMEOUT_MS,
  type JsonObject,
  type ProxyConfigAuthority,
  type ProxyDelaySample,
  type ProxyEntity,
  type ProxyGroupTestPolicy,
  type ProxyKey,
  type ProxyProvider,
  type ProxyRuntimeStats,
  type ProxyStore,
  type ProxyTestPolicy,
} from "./types";

type RecordValue = Record<string, unknown>;

const GROUP_TYPES = new Set([
  "selector",
  "urltest",
  "url-test",
  "fallback",
  "loadbalance",
  "load-balance",
  "relay",
  "load-balance",
  "smart",
]);

const EMPTY_AUTHORITY: ProxyConfigAuthority = {
  mode: "unknown",
  isDefault: false,
  activePath: "",
  activeName: "",
  runtimePath: "configs/mihomo/config.yaml",
  canEditGroups: false,
  canEditProviders: true,
  canEditManualNodes: true,
};

const EMPTY_STATS: ProxyRuntimeStats = {
  connections: 0,
  uploadSpeed: 0,
  downloadSpeed: 0,
  uploadTotal: 0,
  downloadTotal: 0,
  mode: "-",
};

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback?: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback ?? "";
}

function numberValue(value: unknown, fallback?: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return fallback ?? 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toJsonValue(value: unknown): import("./types").JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item) ?? null);
  }
  const object = asRecord(value);
  if (!object) return undefined;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(object)) {
    const normalized = toJsonValue(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function toJsonObject(value: unknown): JsonObject | undefined {
  const normalized = toJsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized : undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sameArray<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameEntity(left: ProxyEntity, right: ProxyEntity): boolean {
  return (
    left.key === right.key &&
    left.name === right.name &&
    left.type === right.type &&
    left.kind === right.kind &&
    sameArray(left.memberKeys, right.memberKeys) &&
    left.selectedKey === right.selectedKey &&
    left.providerName === right.providerName &&
    stableJson(left.history) === stableJson(right.history) &&
    left.alive === right.alive &&
    left.udp === right.udp &&
    left.xudp === right.xudp &&
    left.hidden === right.hidden &&
    left.icon === right.icon &&
    left.order === right.order &&
    left.configOrder === right.configOrder &&
    left.delay === right.delay &&
    stableJson(left.testPolicy) === stableJson(right.testPolicy) &&
    stableJson(left.raw) === stableJson(right.raw)
  );
}

function reuseEntity(previous: ProxyEntity | undefined, next: ProxyEntity): ProxyEntity {
  return previous && sameEntity(previous, next) ? previous : next;
}

export function encodeProxyPart(value: string): string {
  return encodeURIComponent(value);
}

export function makeGlobalProxyKey(name: string): ProxyKey {
  return `global:${encodeProxyPart(name)}`;
}

export function makeProviderProxyKey(providerName: string, name: string): ProxyKey {
  return `provider:${encodeProxyPart(providerName)}:${encodeProxyPart(name)}`;
}

export function makeProxyKey(name: string, providerName?: string): ProxyKey {
  return providerName ? makeProviderProxyKey(providerName, name) : makeGlobalProxyKey(name);
}

export function parseProxyKey(key: ProxyKey): { scope: "global" | "provider"; providerName?: string; name: string } {
  if (key.startsWith("global:")) {
    return { scope: "global", name: decodeURIComponent(key.slice("global:".length)) };
  }
  const body = key.slice("provider:".length);
  const separator = body.indexOf(":");
  if (separator < 0) return { scope: "provider", name: decodeURIComponent(body) };
  return {
    scope: "provider",
    providerName: decodeURIComponent(body.slice(0, separator)),
    name: decodeURIComponent(body.slice(separator + 1)),
  };
}

export function latestProxyDelay(value: unknown): number {
  const row = asRecord(value);
  const direct = numberValue(row?.delay, -1);
  if (direct >= 0) return direct;
  const history = asArray(row?.history);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const sample = asRecord(history[index]);
    const delay = numberValue(sample?.delay, -1);
    if (delay >= 0) return delay;
  }
  return 0;
}

export function normalizeDelayHistory(value: unknown): ProxyDelaySample[] {
  const samples: Array<ProxyDelaySample | undefined> = asArray(value)
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) return { delay: item };
      const row = asRecord(item);
      if (!row) return undefined;
      const delay = numberValue(row.delay, numberValue(row.meanDelay, 0));
      return {
        delay,
        timestamp: text(row.time, text(row.timestamp, text(row.tested_at, undefined))) || undefined,
        meanDelay: numberValue(row.meanDelay, undefined) || undefined,
        success: typeof row.success === "boolean" ? row.success : undefined,
        url: text(row.url, undefined) || undefined,
      } satisfies ProxyDelaySample;
    });
  return samples.filter((item): item is ProxyDelaySample => Boolean(item));
}

function normalizePolicy(value: unknown, source: ProxyTestPolicy["source"], sourceName?: string): ProxyTestPolicy | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const url = text(row.url, text(row["health-check-url"], "")).trim();
  if (!url) return undefined;
  return {
    url,
    timeoutMs: Math.max(1, numberValue(row.timeoutMs, numberValue(row.timeout, DEFAULT_PROXY_TIMEOUT_MS))),
    source,
    sourceName,
    persisted: source !== "temporary" && source !== "page-fallback",
  };
}

function normalizeAuthority(value: unknown): ProxyConfigAuthority {
  const row = asRecord(value);
  if (!row) return EMPTY_AUTHORITY;
  const modeRaw = text(row.mode).toLowerCase();
  const mode: ProxyConfigAuthority["mode"] =
    modeRaw === "custom" ? "custom" : modeRaw === "generated" ? "generated" : modeRaw === "default" ? "default" : "unknown";
  return {
    mode,
    isDefault: booleanValue(row.is_default, booleanValue(row.isDefault, mode === "generated" || mode === "default")),
    activePath: text(row.active_path, text(row.activePath)),
    activeName: text(row.active_name, text(row.activeName)),
    runtimePath: text(row.runtime_path, text(row.runtimePath, EMPTY_AUTHORITY.runtimePath)),
    canEditGroups: booleanValue(row.can_edit_groups, booleanValue(row.canEditGroups, mode === "custom")),
    canEditProviders: booleanValue(row.can_edit_providers, booleanValue(row.canEditProviders, true)),
    canEditManualNodes: booleanValue(row.can_edit_manual_nodes, booleanValue(row.canEditManualNodes, true)),
  };
}

type EntityDraft = {
  key: ProxyKey;
  name: string;
  type: string;
  kind: "node" | "group";
  memberRefs: string[];
  selectedName?: string;
  providerName?: string;
  history: ProxyDelaySample[];
  alive: boolean;
  udp: boolean;
  xudp: boolean;
  hidden: boolean;
  icon?: string;
  order?: number;
  configOrder?: number;
  delay: number;
  testPolicy?: ProxyTestPolicy;
  raw?: JsonObject;
};

function listRefs(value: unknown): string[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item).trim();
      const row = asRecord(item);
      return text(row?.name, text(row?.proxy, "")).trim();
    })
    .filter(Boolean);
}

function draftFromRow(value: unknown, fallbackName = "", providerName?: string, forceKind?: "node" | "group"): EntityDraft | undefined {
  const row = asRecord(value);
  if (!row && !fallbackName) return undefined;
  const source = row ?? {};
  const name = text(source.name, fallbackName).trim();
  if (!name) return undefined;
  const resolvedProviderName =
    providerName ||
    text(source.provider_name, text(source.providerName, text(source.provider, undefined))).trim() ||
    undefined;
  const type = text(source.type, "unknown");
  const memberRefs = listRefs(source.all ?? source.proxies ?? source.members);
  const kind: "node" | "group" = forceKind ?? (text(source.kind).toLowerCase() === "group" || GROUP_TYPES.has(type.toLowerCase()) || memberRefs.length > 0 ? "group" : "node");
  const policy = normalizePolicy(source.test_policy ?? source.testPolicy, kind === "group" ? "group-config" : "provider-config", resolvedProviderName || name);
  const delay = latestProxyDelay(source);
  return {
    key: makeProxyKey(name, resolvedProviderName),
    name,
    type,
    kind,
    memberRefs,
    selectedName: text(source.now, text(source.selected, undefined)).trim() || undefined,
    providerName: resolvedProviderName,
    history: normalizeDelayHistory(source.history),
    alive: booleanValue(source.alive, kind === "group" || delay > 0 || type.toLowerCase() === "direct"),
    udp: booleanValue(source.udp),
    xudp: booleanValue(source.xudp, booleanValue(source["xudp"])),
    hidden: booleanValue(source.hidden),
    icon: text(source.icon, undefined) || undefined,
    order: optionalNumber(source.order),
    configOrder: optionalNumber(source.config_order) ?? optionalNumber(source.configOrder),
    delay,
    testPolicy: policy,
    raw: toJsonObject(source),
  };
}

function providerEntries(value: unknown): Array<{ id: string; row: RecordValue }> {
  const out: Array<{ id: string; row: RecordValue }> = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const row = asRecord(item);
      if (row) out.push({ id: text(row.id, text(row.name, `provider-${index}`)), row });
    });
    return out;
  }
  const object = asRecord(value);
  if (!object) return out;
  for (const [id, item] of Object.entries(object)) {
    const row = asRecord(item);
    if (row) out.push({ id, row });
  }
  return out;
}

function providerPayload(data: RecordValue): unknown {
  const providerContainer = data.providers;
  if (providerContainer && asRecord(providerContainer)?.providers) return asRecord(providerContainer)?.providers;
  return providerContainer ?? data.proxy_providers ?? data.proxyProviders;
}

function proxyMapPayload(data: RecordValue): RecordValue | undefined {
  const value = data.proxies;
  if (asRecord(value)) {
    const nested = asRecord(value)?.proxies;
    return nested && asRecord(nested) ? asRecord(nested) : (value as RecordValue);
  }
  const raw = asRecord(data.raw);
  const rawProxies = raw && asRecord(raw.proxies);
  return rawProxies;
}

function unwrapSnapshot(payload: unknown): RecordValue {
  const outer = asRecord(payload) ?? {};
  const data = asRecord(outer.data) ?? outer;
  return asRecord(data.data) ?? data;
}

function normalizeStats(data: RecordValue, previous?: ProxyRuntimeStats): ProxyRuntimeStats {
  const source = asRecord(data.stats) ?? asRecord(data.overview) ?? {};
  return {
    connections: numberValue(source.connections, numberValue(source.connection_count, previous?.connections ?? 0)),
    uploadSpeed: numberValue(source.upload_speed, numberValue(source.uploadSpeed, previous?.uploadSpeed ?? 0)),
    downloadSpeed: numberValue(source.download_speed, numberValue(source.downloadSpeed, previous?.downloadSpeed ?? 0)),
    uploadTotal: numberValue(source.upload_total, numberValue(source.uploadTotal, previous?.uploadTotal ?? 0)),
    downloadTotal: numberValue(source.download_total, numberValue(source.downloadTotal, previous?.downloadTotal ?? 0)),
    mode: text(source.mode, previous?.mode ?? "-"),
  };
}

function resolveRef(
  reference: string,
  entities: Map<ProxyKey, EntityDraft>,
  byName: Map<string, ProxyKey[]>,
  preferredProvider?: string,
): ProxyKey | undefined {
  const trimmed = reference.trim();
  if (!trimmed) return undefined;
  for (const key of entities.keys()) {
    if (key === trimmed) return key;
  }
  const providerSeparator = trimmed.indexOf("/");
  if (providerSeparator > 0) {
    const provider = trimmed.slice(0, providerSeparator);
    const name = trimmed.slice(providerSeparator + 1);
    const candidate = makeProviderProxyKey(provider, name);
    if (entities.has(candidate)) return candidate;
  }
  if (preferredProvider) {
    const candidate = makeProviderProxyKey(preferredProvider, trimmed);
    if (entities.has(candidate)) return candidate;
  }
  const candidates = byName.get(trimmed) ?? [];
  return candidates.find((key) => key.startsWith("global:")) ?? candidates[0];
}

/** Convert every supported controller/MSF response shape into the shared store. */
export function normalizeProxySnapshot(payload: unknown, previous?: ProxyStore, fetchedAt = Date.now()): ProxyStore {
  const data = unwrapSnapshot(payload);
  const drafts = new Map<ProxyKey, EntityDraft>();
  const byName = new Map<string, ProxyKey[]>();
  const providers: Record<string, ProxyProvider> = {};
  const providerIds: string[] = [];

  const addDraft = (draft: EntityDraft | undefined) => {
    if (!draft) return;
    const existing = drafts.get(draft.key);
    // A group row frequently appears both in `groups` and in the proxy map;
    // preserve the richer group representation when that happens.
    if (existing && existing.kind === "group" && draft.kind === "node") return;
    drafts.set(draft.key, existing && existing.kind === "group" && draft.kind === "group" ? {
      ...existing,
      ...draft,
      memberRefs: draft.memberRefs.length ? draft.memberRefs : existing.memberRefs,
      configOrder: draft.configOrder ?? existing.configOrder,
    } : draft);
    const names = byName.get(draft.name) ?? [];
    if (!names.includes(draft.key)) names.push(draft.key);
    byName.set(draft.name, names);
  };

  const providerRows = providerEntries(providerPayload(data));
  const providerArrayRows = asArray(data.provider_list ?? data.providerList ?? data.runtime_items);
  for (const item of providerArrayRows) {
    const row = asRecord(item);
    if (row) providerRows.push({ id: text(row.id, text(row.name, `provider-${providerRows.length}`)), row });
  }

  for (const { id, row } of providerRows) {
    const name = text(row.name, id).trim() || id;
    if (providerIds.includes(id)) continue;
    providerIds.push(id);
    const runtime = asRecord(row.runtime);
    const providerProxies = asArray(row.proxies ?? runtime?.proxies ?? row.items ?? row.proxy_list ?? row.nodes);
    const keys: ProxyKey[] = [];
    for (const item of providerProxies) {
      const draft = draftFromRow(item, "", name, "node");
      addDraft(draft);
      if (draft && !keys.includes(draft.key)) keys.push(draft.key);
    }
    const policy = normalizePolicy(row.test_policy ?? row.testPolicy ?? row["health-check"] ?? row.healthCheck, "provider-config", name);
    if (policy) {
      for (const key of keys) {
        const draft = drafts.get(key);
        if (draft && !draft.testPolicy) draft.testPolicy = policy;
      }
    }
    const subscription = toJsonObject(row.subscription ?? row.subscription_info ?? row.usage ?? runtime?.subscriptionInfo ?? runtime?.subscription_info ?? runtime?.usage);
    providers[id] = {
      id,
      name,
      proxyKeys: keys,
      vehicleType: text(row.vehicleType, text(row.vehicle_type, text(runtime?.vehicleType, text(runtime?.vehicle_type, text(row.type, ""))))),
      updatedAt: text(row.updatedAt, text(row.updated_at, text(runtime?.updatedAt, text(runtime?.updated_at, undefined)))) || undefined,
      testPolicy: policy,
      subscription: subscription as ProxyProvider["subscription"],
      // Provider summary counters are optional in Mihomo's runtime payload.
      // Preserve absence as `undefined` so the view can derive counts from the
      // actual proxy rows instead of rendering a misleading 0/0 summary.
      alive: optionalNumber(row.alive),
      total: optionalNumber(row.total),
      used: optionalNumber(row.used),
      quota: optionalNumber(row.quota),
      percent: optionalNumber(row.percent),
      raw: toJsonObject(row),
    };
  }

  const groups = asArray(data.groups ?? data.proxy_groups ?? data.proxyGroups);
  const groupKeysInPayload: ProxyKey[] = [];
  for (const [index, item] of groups.entries()) {
    const draft = draftFromRow(item, "", undefined, "group");
    if (draft && draft.configOrder === undefined) draft.configOrder = index;
    addDraft(draft);
    if (draft && !groupKeysInPayload.includes(draft.key)) groupKeysInPayload.push(draft.key);
  }

  const map = proxyMapPayload(data);
  if (map) {
    for (const [fallbackName, value] of Object.entries(map)) {
      const row = asRecord(value);
      const providerName = row ? text(row.provider_name, text(row.providerName, text(row.provider, undefined))).trim() || undefined : undefined;
      const draft = draftFromRow(value, fallbackName, providerName);
      addDraft(draft);
      if (draft?.kind === "group" && !groupKeysInPayload.includes(draft.key)) groupKeysInPayload.push(draft.key);
    }
  }

  for (const item of asArray(data.proxy_list ?? data.nodes ?? data.proxyList)) {
    const draft = draftFromRow(item);
    addDraft(draft);
    if (draft?.kind === "group" && !groupKeysInPayload.includes(draft.key)) groupKeysInPayload.push(draft.key);
  }

  const groupPolicies: Record<string, ProxyGroupTestPolicy> = {};
  const entities: Record<ProxyKey, ProxyEntity> = {};
  for (const draft of drafts.values()) {
    const memberKeys = draft.memberRefs
      .map((reference) => resolveRef(reference, drafts, byName, draft.providerName))
      .filter((key): key is ProxyKey => Boolean(key));
    const selectedKey = draft.selectedName ? resolveRef(draft.selectedName, drafts, byName, draft.providerName) : undefined;
    const entity: ProxyEntity = {
      key: draft.key,
      name: draft.name,
      type: draft.type,
      kind: draft.kind,
      memberKeys,
      selectedKey,
      providerName: draft.providerName,
      history: draft.history,
      alive: draft.alive,
      udp: draft.udp,
      xudp: draft.xudp,
      hidden: draft.hidden,
      icon: draft.icon,
      order: draft.order,
      configOrder: draft.configOrder,
      delay: draft.delay,
      testPolicy: draft.testPolicy,
      raw: draft.raw,
    };
    entities[draft.key] = reuseEntity(previous?.entities[draft.key], entity);
    if (draft.kind === "group" && draft.testPolicy) {
      groupPolicies[draft.name] = { url: draft.testPolicy.url, timeoutMs: draft.testPolicy.timeoutMs };
    }
  }

  const groupKeys = Array.from(new Set(groupKeysInPayload.filter((key) => entities[key]?.kind === "group")));
  for (const key of Object.keys(entities) as ProxyKey[]) {
    if (entities[key].kind === "group" && !groupKeys.includes(key)) groupKeys.push(key);
  }
  const orderOf = (key: ProxyKey) => {
    const entity = entities[key];
    return entity.configOrder ?? entity.order ?? Number.MAX_SAFE_INTEGER;
  };
  groupKeys.sort((left, right) => {
    const order = orderOf(left) - orderOf(right);
    return order || entities[left].name.localeCompare(entities[right].name);
  });

  const pagePolicy = normalizePolicy(data.test_policy ?? data.testPolicy, "page-fallback") ?? {
    url: DEFAULT_PROXY_TEST_URL,
    timeoutMs: DEFAULT_PROXY_TIMEOUT_MS,
    source: "page-fallback" as const,
    persisted: false,
  };
  const authority = normalizeAuthority(data.config_authority ?? data.configAuthority ?? data.authority);
  const stats = normalizeStats(data, previous?.stats);

  // Keep object identity for untouched provider records and order arrays.
  const nextProviders = providers;
  const sameProviderMap = previous && stableJson(previous.providers) === stableJson(nextProviders);
  return {
    entities,
    groupKeys: sameArray(previous?.groupKeys ?? [], groupKeys) ? previous?.groupKeys ?? groupKeys : groupKeys,
    providers: sameProviderMap ? previous.providers : nextProviders,
    providerIds: sameArray(previous?.providerIds ?? [], providerIds) ? previous?.providerIds ?? providerIds : providerIds,
    fetchedAt,
    stats,
    authority,
    pageTestPolicy: pagePolicy,
    groupPolicies,
  };
}

export const normalizeProxyStore = normalizeProxySnapshot;
