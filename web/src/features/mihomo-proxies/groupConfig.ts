export interface ProxyGroupDraftInput {
  name: string;
  type: string;
  icon: string;
  proxies: string;
  url: string;
  interval: number;
  lazy: boolean;
  tolerance: number;
  strategy: string;
  // Smart proxy-group fields. The editor owns these only for `smart` type;
  // for every other type they are ignored and the unknown advanced JSON is kept
  // untouched.
  policyPriority: string;
  uselightgbm: boolean;
  collectdata: boolean;
  sampleRate: number;
  preferAsn: boolean;
  advanced: string;
}

/** YAML/JSON keys exactly as Mihomo expects for a `smart` group. */
export const SMART_GROUP_FIELDS = [
  "policy-priority",
  "uselightgbm",
  "collectdata",
  "sample-rate",
  "prefer-asn",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Keys the editor model owns for the health-checked / select family. These are
 * either re-emitted (health-checked) or intentionally dropped (select). */
const STANDARD_OWNED_KEYS = ["name", "type", "icon", "proxies", "url", "interval", "lazy", "tolerance", "strategy"];

/** For `smart` groups the editor does not render url / timeout / max-failed-times
 * safely, so those top-level fields must survive as unknown advanced JSON rather
 * than being stripped. The Smart fields themselves are owned and re-emitted. */
const SMART_OWNED_KEYS = ["name", "type", "icon", "proxies", "interval", "lazy", "tolerance", "strategy", ...SMART_GROUP_FIELDS];

export function proxyGroupRows(payload: unknown): Record<string, unknown>[] {
  const root = record(payload);
  const data = record(root.data);
  const value = Array.isArray(payload)
    ? payload
    : data["proxy-groups"] ?? data.proxy_groups ?? data.groups
      ?? root["proxy-groups"] ?? root.proxy_groups ?? root.groups;
  return Array.isArray(value) ? value.map(record) : [];
}

export function proxyGroupDraft(row: Record<string, unknown>): ProxyGroupDraftInput {
  return {
    name: String(row.name || ""),
    type: String(row.type || "select"),
    icon: String(row.icon || ""),
    // Only configured members belong here. Controller `all` entries may contain
    // provider nodes that cannot be referenced directly in static YAML.
    proxies: Array.isArray(row.proxies) ? row.proxies.map(String).join("\n") : "",
    url: String(row.url || ""),
    interval: Number(row.interval || 300),
    lazy: Boolean(row.lazy),
    tolerance: Number(row.tolerance || 50),
    strategy: String(row.strategy || "consistent-hashing"),
    policyPriority: String(row["policy-priority"] || ""),
    uselightgbm: Boolean(row.uselightgbm),
    collectdata: Boolean(row.collectdata),
    sampleRate: Number(row["sample-rate"] || 0),
    preferAsn: Boolean(row["prefer-asn"]),
    advanced: JSON.stringify(row, null, 2),
  };
}

export function buildProxyGroupRow(draft: ProxyGroupDraftInput): Record<string, unknown> {
  const advanced = draft.advanced.trim() ? record(JSON.parse(draft.advanced)) : {};
  const next: Record<string, unknown> = { ...advanced };
  const type = draft.type.trim() || "select";
  const isSmart = type === "smart";
  for (const key of isSmart ? SMART_OWNED_KEYS : STANDARD_OWNED_KEYS) {
    delete next[key];
  }

  const name = draft.name.trim();
  next.name = name;
  next.type = type;
  if (draft.icon.trim()) next.icon = draft.icon.trim();

  const members = draft.proxies
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (members.length) next.proxies = members;

  const healthChecked = ["url-test", "fallback", "load-balance"].includes(type);
  if (healthChecked) {
    if (draft.url.trim()) next.url = draft.url.trim();
    if (draft.interval > 0) next.interval = draft.interval;
    next.lazy = Boolean(draft.lazy);
  }
  if (type === "url-test" && draft.tolerance > 0) next.tolerance = draft.tolerance;
  if (type === "load-balance" && draft.strategy.trim()) next.strategy = draft.strategy.trim();

  if (isSmart) {
    if (draft.policyPriority.trim()) next["policy-priority"] = draft.policyPriority.trim();
    // uselightgbm and collectdata default to false; always emit so a smart group
    // round-trips its configured value instead of silently dropping it.
    next.uselightgbm = Boolean(draft.uselightgbm);
    next.collectdata = Boolean(draft.collectdata);
    if (Number.isFinite(draft.sampleRate) && draft.sampleRate > 0 && draft.sampleRate <= 1) {
      next["sample-rate"] = draft.sampleRate;
    }
    next["prefer-asn"] = Boolean(draft.preferAsn);
  }
  return next;
}

export function replaceProxyGroup(
  rows: Record<string, unknown>[],
  originalName: string,
  next: Record<string, unknown>,
): Record<string, unknown>[] {
  const result = [...rows];
  const index = result.findIndex((row) => String(row.name || "") === originalName);
  if (index >= 0) result[index] = next;
  else result.push(next);
  return result;
}
