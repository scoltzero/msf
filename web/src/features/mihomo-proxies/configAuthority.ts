import { type ProxyConfigAuthority, type ProxyConfigAuthorityMode, type JsonObject } from "./types";

const DEFAULT_RUNTIME_PATH = "configs/mihomo/config.yaml";

export const DEFAULT_CONFIG_AUTHORITY: ProxyConfigAuthority = {
  mode: "unknown",
  isDefault: false,
  activePath: "",
  activeName: "",
  runtimePath: DEFAULT_RUNTIME_PATH,
  canEditGroups: false,
  canEditProviders: true,
  canEditManualNodes: true,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function modeValue(value: unknown): ProxyConfigAuthorityMode {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === "custom") return "custom";
  if (normalized === "generated") return "generated";
  if (normalized === "default") return "default";
  return "unknown";
}

/** Normalize the explicit backend authority response; never infer permissions
 * from the active filename. */
export function normalizeConfigAuthority(payload: unknown): ProxyConfigAuthority {
  const outer = record(payload);
  const source = record(outer?.data) ?? record(outer?.config_authority) ?? record(outer?.configAuthority) ?? outer;
  if (!source) return { ...DEFAULT_CONFIG_AUTHORITY };
  const mode = modeValue(source.mode);
  return {
    mode,
    isDefault: bool(source.is_default, bool(source.isDefault, mode === "generated" || mode === "default")),
    activePath: stringValue(source.active_path ?? source.activePath),
    activeName: stringValue(source.active_name ?? source.activeName),
    runtimePath: stringValue(source.runtime_path ?? source.runtimePath) || DEFAULT_RUNTIME_PATH,
    canEditGroups: bool(source.can_edit_groups, bool(source.canEditGroups, mode === "custom")),
    canEditProviders: bool(source.can_edit_providers, bool(source.canEditProviders, true)),
    canEditManualNodes: bool(source.can_edit_manual_nodes, bool(source.canEditManualNodes, true)),
  };
}

export function canEditProxyGroups(authority: ProxyConfigAuthority | undefined): boolean {
  return authority?.canEditGroups === true;
}

export function canEditProxyProviders(authority: ProxyConfigAuthority | undefined): boolean {
  return authority?.canEditProviders === true;
}

export function canEditManualProxies(authority: ProxyConfigAuthority | undefined): boolean {
  return authority?.canEditManualNodes === true;
}

export function configModeLabel(authority: ProxyConfigAuthority | undefined): string {
  switch (authority?.mode) {
    case "generated":
    case "default":
      return "默认配置";
    case "custom":
      return authority.activeName ? `自定义 · ${authority.activeName}` : "自定义配置";
    default:
      return "配置状态未知";
  }
}

export function authorityForEdit(authority: ProxyConfigAuthority, scope: "groups" | "providers" | "manual-nodes"): boolean {
  if (scope === "groups") return authority.canEditGroups;
  if (scope === "providers") return authority.canEditProviders;
  return authority.canEditManualNodes;
}

export function authorityJson(authority: ProxyConfigAuthority): JsonObject {
  return {
    mode: authority.mode,
    is_default: authority.isDefault,
    active_path: authority.activePath,
    active_name: authority.activeName,
    runtime_path: authority.runtimePath,
    can_edit_groups: authority.canEditGroups,
    can_edit_providers: authority.canEditProviders,
    can_edit_manual_nodes: authority.canEditManualNodes,
  };
}
