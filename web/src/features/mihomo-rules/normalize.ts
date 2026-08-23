import {
  DEFAULT_RULE_AUTHORITY,
  EMPTY_RULE_CAPABILITIES,
  type JsonObject,
  type RuleCapabilities,
  type RuleConfigAuthority,
  type RuleConfigAuthorityMode,
  type RuleStore,
  type RuntimeRule,
  type RuntimeRuleProvider,
  type RuleTargetState,
} from "./types";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function optionalText(value: unknown): string | undefined {
  const result = text(value).trim();
  return result ? result : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const result = Number(value);
    if (Number.isFinite(result)) return result;
  }
  return undefined;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function unwrap(value: unknown): RecordValue {
  const root = record(value);
  const data = record(root?.data);
  return data ?? root ?? {};
}

function jsonObject(value: unknown): JsonObject | undefined {
  const source = record(value);
  if (!source) return undefined;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(source)) {
    const converted = toJsonValue(item);
    if (converted !== undefined) out[key] = converted;
  }
  return out;
}

function toJsonValue(value: unknown): import("./types").JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item) ?? null);
  return jsonObject(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`).join(",")}}`;
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameRule(left: RuntimeRule, right: RuntimeRule): boolean {
  return left.id === right.id && left.index === right.index && left.type === right.type && left.normalizedType === right.normalizedType &&
    left.payload === right.payload && left.target === right.target && left.provider === right.provider && left.disabled === right.disabled &&
    left.size === right.size && left.hitCount === right.hitCount && left.missCount === right.missCount && left.lastHitAt === right.lastHitAt &&
    left.lastMissAt === right.lastMissAt && stableJson(left.raw) === stableJson(right.raw);
}

function sameProvider(left: RuntimeRuleProvider, right: RuntimeRuleProvider): boolean {
  return left.name === right.name && left.type === right.type && left.behavior === right.behavior && left.vehicleType === right.vehicleType &&
    left.format === right.format && left.url === right.url && left.path === right.path && left.interval === right.interval && left.size === right.size &&
    left.ruleCount === right.ruleCount && left.updatedAt === right.updatedAt && left.updating === right.updating && left.lastUpdateError === right.lastUpdateError &&
    left.usingStaleCache === right.usingStaleCache && stableJson(left.config) === stableJson(right.config) && stableJson(left.runtime) === stableJson(right.runtime) &&
    stableJson(left.raw) === stableJson(right.raw);
}

function sourceRows(value: unknown, keys: readonly string[]): unknown[] {
  const root = unwrap(value);
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  if (Array.isArray(value)) return value;
  return [];
}

function first(value: RecordValue, keys: readonly string[]): unknown {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
}

function normalizeIndex(value: unknown, fallback: number): number {
  const parsed = numberValue(value);
  return parsed === undefined ? fallback : parsed;
}

function normalizeRuleRow(value: unknown, position: number): RuntimeRule | undefined {
  const source = record(value);
  const fallbackIndex = position + 1;
  if (!source && typeof value !== "string") return undefined;
  const raw = source ?? { value };
  const stringRule = typeof value === "string" ? value : undefined;
  const parts = stringRule ? stringRule.split(",") : [];
  const index = normalizeIndex(first(source ?? {}, ["index", "position", "order"]), fallbackIndex);
  const id = optionalText(first(source ?? {}, ["id", "uuid", "rule_id"])) ?? String(index);
  const uuid = optionalText(first(source ?? {}, ["uuid", "ruleUUID", "rule_uuid"]));
  const type = text(first(source ?? {}, ["type", "ruleType"]) ?? parts[0], "MATCH");
  const payload = text(first(source ?? {}, ["payload", "rule_payload", "rulePayload"]) ?? parts[1]);
  const target = text(first(source ?? {}, ["proxy", "group", "adapter", "target"]) ?? parts[2], "-");
  const provider = optionalText(first(source ?? {}, ["provider", "ruleProvider", "rule_provider"]));
  const extra = record(source?.extra);
  const stats = extra ?? {};
  const hitCount = numberValue(first(source ?? {}, ["hitCount", "hit_count", "hits"]) ?? first(stats, ["hitCount", "hit_count", "hits"]));
  const missCount = numberValue(first(source ?? {}, ["missCount", "miss_count", "misses"]) ?? first(stats, ["missCount", "miss_count", "misses"]));
  const lastHitAt = optionalText(first(source ?? {}, ["lastHitAt", "last_hit_at", "hitAt", "hit_at"]) ?? first(stats, ["lastHitAt", "last_hit_at", "hitAt", "hit_at"]));
  const lastMissAt = optionalText(first(source ?? {}, ["lastMissAt", "last_miss_at", "missAt", "miss_at"]) ?? first(stats, ["lastMissAt", "last_miss_at", "missAt", "miss_at"]));
  const size = numberValue(first(source ?? {}, ["size", "bytes"]));
  return {
    id,
    uuid,
    index,
    type,
    normalizedType: type.trim().toLocaleLowerCase(),
    payload,
    target,
    provider,
    disabled: bool(first(source ?? {}, ["disabled", "isDisabled", "is_disabled"])),
    size,
    hitCount,
    missCount,
    lastHitAt,
    lastMissAt,
    raw: source ? value : stringRule,
  };
}

export function normalizeRules(payload: unknown): RuntimeRule[] {
  const root = unwrap(payload);
  const rows = Array.isArray(payload) ? payload : sourceRows(root, ["rules", "items", "data"]);
  return rows.map(normalizeRuleRow).filter((item): item is RuntimeRule => Boolean(item));
}

function providerRows(value: unknown): Array<{ name: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ name: optionalText(record(item)?.name) ?? `provider-${index + 1}`, value: item }));
  }
  const root = unwrap(value);
  const candidates = [root["items"], root["providers"], root["rule_providers"], root["rule-providers"], root["runtime_items"], root["runtime_providers"]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item, index) => {
        const row = record(item);
        return { name: optionalText(row?.name) ?? `provider-${index + 1}`, value: item };
      });
    }
    const map = record(candidate);
    if (map) return Object.entries(map).map(([name, item]) => ({ name, value: item }));
  }
  return [];
}

function mergeRecord(left: RecordValue | undefined, right: RecordValue | undefined): JsonObject | undefined {
  if (!left && !right) return undefined;
  return jsonObject({ ...(left ?? {}), ...(right ?? {}) });
}

function normalizeProvider(name: string, value: unknown): RuntimeRuleProvider {
  const row = record(value) ?? {};
  const config = record(row.config) ?? record(row.definition) ?? row;
  const runtime = record(row.runtime) ?? record(row.state);
  const rules = array(first(runtime ?? {}, ["rules", "items"]) ?? first(row, ["rules", "items"]));
  const type = text(first(row, ["type", "provider_type", "vehicleType", "vehicle_type"]) ?? first(runtime ?? {}, ["type", "vehicleType"]), "rule");
  const behavior = optionalText(first(row, ["behavior"]) ?? first(runtime ?? {}, ["behavior"]));
  const vehicleType = optionalText(first(row, ["vehicleType", "vehicle_type", "type"]));
  const format = optionalText(first(row, ["format"]) ?? first(runtime ?? {}, ["format"]));
  const size = numberValue(first(runtime ?? {}, ["size", "bytes"]) ?? first(row, ["size", "bytes"]));
  const ruleCount = numberValue(first(runtime ?? {}, ["ruleCount", "rule_count", "count"]) ?? first(row, ["ruleCount", "rule_count", "count"]) ?? (rules.length ? rules.length : undefined));
  const updatedAt = optionalText(first(runtime ?? {}, ["updatedAt", "updated_at", "last_update", "updated"]) ?? first(row, ["updatedAt", "updated_at", "last_update", "updated"]));
  const lastUpdateError = optionalText(first(row, ["lastUpdateError", "last_update_error", "error"]));
  return {
    name,
    type,
    behavior,
    vehicleType,
    format,
    url: optionalText(first(config, ["url"])),
    path: optionalText(first(config, ["path", "file"])),
    interval: numberValue(first(config, ["interval"])),
    size,
    ruleCount,
    updatedAt,
    updating: bool(first(row, ["updating", "isUpdating"])),
    lastUpdateError,
    usingStaleCache: bool(first(row, ["usingStaleCache", "using_stale_cache", "stale"])),
    config: mergeRecord(config, undefined),
    runtime: mergeRecord(runtime, undefined),
    raw: value,
  };
}

export function normalizeRuleProviders(payload: unknown): Record<string, RuntimeRuleProvider> {
  const result: Record<string, RuntimeRuleProvider> = {};
  for (const item of providerRows(payload)) {
    if (!item.name.trim()) continue;
    result[item.name] = normalizeProvider(item.name, item.value);
  }
  return result;
}

function normalizeAuthority(value: unknown): RuleConfigAuthority {
  const root = unwrap(value);
  const source = record(root.config_authority) ?? record(root.configAuthority) ?? record(root.authority) ?? root;
  const modeRaw = text(source.mode).toLocaleLowerCase();
  const mode: RuleConfigAuthorityMode = modeRaw === "custom" ? "custom" : modeRaw === "generated" ? "generated" : modeRaw === "default" ? "default" : "unknown";
  return {
    mode,
    isDefault: bool(first(source, ["is_default", "isDefault"]), mode === "generated" || mode === "default"),
    activePath: text(first(source, ["active_path", "activePath"])),
    activeName: text(first(source, ["active_name", "activeName"])),
    runtimePath: text(first(source, ["runtime_path", "runtimePath"]), DEFAULT_RULE_AUTHORITY.runtimePath),
    canEditRules: bool(first(source, ["can_edit_rules", "canEditRules"]), mode === "custom"),
    canEditRuleProviders: bool(first(source, ["can_edit_rule_providers", "canEditRuleProviders"]), mode === "custom"),
  };
}

export function normalizeConfigAuthority(payload: unknown): RuleConfigAuthority {
  return normalizeAuthority(payload);
}

function latestDelay(value: unknown): number | undefined {
  const row = record(value);
  const direct = numberValue(row?.delay);
  if (direct !== undefined && direct > 0) return direct;
  for (const item of array(row?.history).slice().reverse()) {
    const delay = numberValue(record(item)?.delay ?? item);
    if (delay !== undefined && delay > 0) return delay;
  }
  return undefined;
}

function normalizeProxyTargets(payload: unknown): Record<string, RuleTargetState> {
  const root = unwrap(payload);
  const candidates = [root.groups, root.proxy_groups, root.proxies, root.items, root.proxy_list];
  const rows: unknown[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) rows.push(...candidate);
    else {
      const map = record(candidate);
      if (map) rows.push(...Object.entries(map).map(([name, value]) => ({ ...(record(value) ?? {}), name })));
    }
  }
  const nodes = new Map<string, { selected?: string; delay?: number; isGroup: boolean; type?: string; members: string[]; alive?: boolean; providerName?: string }>();
  for (const value of rows) {
    const row = record(value);
    if (!row) continue;
    const name = optionalText(row.name);
    if (!name) continue;
    const members = array(first(row, ["all", "proxies", "members"]))
      .map((item) => optionalText(record(item)?.name ?? item))
      .filter((item): item is string => Boolean(item));
    const type = optionalText(row.type);
    const isGroup = members.length > 0 || ["selector", "url-test", "urltest", "fallback", "load-balance", "loadbalance", "relay"].includes(text(row.type).toLocaleLowerCase());
    nodes.set(name, {
      selected: optionalText(first(row, ["now", "selected", "current"])),
      delay: latestDelay(row),
      isGroup,
      type,
      members,
      alive: row.alive === undefined ? undefined : bool(row.alive),
      providerName: optionalText(first(row, ["providerName", "provider_name", "provider-name", "provider"])),
    });
  }
  const out: Record<string, RuleTargetState> = {};
  for (const [name, node] of nodes) {
    const chain: string[] = [name];
    const visited = new Set<string>([name]);
    let current = node.selected;
    let cycleDetected = false;
    let missingReference: string | undefined;
    while (current) {
      if (visited.has(current)) {
        cycleDetected = true;
        break;
      }
      visited.add(current);
      chain.push(current);
      const next = nodes.get(current);
      if (!next) {
        missingReference = current;
        break;
      }
      current = next.isGroup ? next.selected : undefined;
    }
    const finalNode = !cycleDetected && !missingReference ? chain[chain.length - 1] : undefined;
    out[name] = {
      groupName: name,
      type: node.type,
      selectedName: node.selected,
      members: node.members.map((memberName) => {
        const member = nodes.get(memberName);
        return {
          name: memberName,
          type: member?.type,
          kind: member?.isGroup ? "group" : "node",
          delay: member?.delay,
          alive: member?.alive,
          providerName: member?.providerName,
        };
      }),
      chain,
      finalNode,
      delay: node.delay ?? (finalNode ? nodes.get(finalNode)?.delay : undefined),
      cycleDetected,
      missingReference,
    };
  }
  return out;
}

function normalizeCapabilities(value: unknown, hasProviders: boolean, previous?: RuleCapabilities): RuleCapabilities {
  const root = unwrap(value);
  const source = record(root.capabilities) ?? root;
  return {
    ruleToggle: bool(first(source, ["rule_toggle", "ruleToggle", "toggle"]), previous?.ruleToggle ?? false),
    ruleStats: bool(first(source, ["rule_stats", "ruleStats", "stats"]), previous?.ruleStats ?? true),
    providerUpdate: bool(first(source, ["provider_update", "providerUpdate", "update"]), previous?.providerUpdate ?? hasProviders),
  };
}

function normalizeSource(value: unknown): RuleStore["source"] {
  const source = text(first(unwrap(value), ["source", "origin"])).toLocaleLowerCase();
  return source === "controller" ? "controller" : source === "cache" ? "cache" : "unknown";
}

/** Normalize a combined load payload while preserving object identity for rows
 * that have not changed.  `payload` may be a combined object or the object
 * returned by /rules; separate responses can be passed through `responses`.
 */
export function normalizeRuleSnapshot(
  payload: unknown,
  previous?: RuleStore,
  fetchedAt = Date.now(),
  responses?: { rules?: unknown; providers?: unknown; proxies?: unknown; authority?: unknown },
): RuleStore {
  const root = unwrap(payload);
  const rulesPayload = root.rules !== undefined || root.items !== undefined ? root : payload;
  const nextRulesRaw = normalizeRules(rulesPayload);
  const rules = nextRulesRaw.map((rule) => {
    const old = previous?.rules.find((item) => item.id === rule.id);
    return old && sameRule(old, rule) ? old : rule;
  });
  const providerPayload = responses?.providers ?? root.providers ?? root.rule_providers ?? root["rule-providers"];
  const nextProvidersRaw = normalizeRuleProviders(providerPayload);
  const providers: Record<string, RuntimeRuleProvider> = {};
  for (const [name, provider] of Object.entries(nextProvidersRaw)) {
    const old = previous?.providers[name];
    providers[name] = old && sameProvider(old, provider) ? old : provider;
  }
  const providerNames = Object.keys(providers);
  const targets = normalizeProxyTargets(responses?.proxies ?? root.proxies ?? root.proxy_groups ?? root.groups);
  const authority = normalizeAuthority(responses?.authority ?? root.config_authority ?? root.configAuthority ?? root.authority);
  const capabilities = normalizeCapabilities(root, Object.keys(providers).length > 0, previous?.capabilities);
  const explicitSource = normalizeSource(root);
  const source = explicitSource === "unknown" && responses?.rules !== undefined ? "controller" : explicitSource;
  const controllerAvailable = source === "controller" || Boolean(root.controller_available ?? root.controllerAvailable);
  return {
    rules,
    providers,
    providerNames: sameArray(previous?.providerNames ?? [], providerNames) ? previous?.providerNames ?? providerNames : providerNames,
    targets,
    capabilities,
    authority,
    fetchedAt,
    source,
    controllerAvailable,
  };
}

export function normalizeRuleStore(
  responses: { rules?: unknown; providers?: unknown; proxies?: unknown; authority?: unknown },
  previous?: RuleStore,
  fetchedAt = Date.now(),
): RuleStore {
  return normalizeRuleSnapshot(responses.rules ?? {}, previous, fetchedAt, responses);
}

export const normalizeRulesRuntime = normalizeRules;
export const normalizeRuleProvider = normalizeRuleProviders;
