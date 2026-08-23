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
  advanced: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
    advanced: JSON.stringify(row, null, 2),
  };
}

export function buildProxyGroupRow(draft: ProxyGroupDraftInput): Record<string, unknown> {
  const advanced = draft.advanced.trim() ? record(JSON.parse(draft.advanced)) : {};
  const next: Record<string, unknown> = { ...advanced };
  for (const key of ["name", "type", "icon", "proxies", "url", "interval", "lazy", "tolerance", "strategy"]) {
    delete next[key];
  }

  const name = draft.name.trim();
  const type = draft.type.trim() || "select";
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
