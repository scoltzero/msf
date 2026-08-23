import { DEFAULT_RULE_AUTHORITY, type RuleConfigAuthority, type RuleConfigAuthorityMode } from "./types";

export function canEditRules(authority: RuleConfigAuthority | undefined): boolean {
  return authority?.canEditRules === true && authority.mode === "custom";
}
export function canEditRuleProviders(authority: RuleConfigAuthority | undefined): boolean {
  return authority?.canEditRuleProviders === true && authority.mode === "custom";
}

export function configModeLabel(authority: RuleConfigAuthority | undefined): string {
  switch (authority?.mode) {
    case "custom":
      return authority.activeName ? `自定义 · ${authority.activeName}` : "自定义配置";
    case "generated":
    case "default":
      return "默认配置";
    default:
      return "配置状态未知";
  }
}

export function configModeDescription(authority: RuleConfigAuthority | undefined): string {
  if (authority?.mode === "custom") return authority.activePath ? `应用文件 ${authority.activePath}` : "规则配置可编辑";
  if (authority?.mode === "generated" || authority?.mode === "default") return "规则配置由 MSF 默认配置生成";
  return "尚未确认配置权威";
}

export function normalizeRuleAuthority(value: unknown): RuleConfigAuthority {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_RULE_AUTHORITY };
  const source = value as Record<string, unknown>;
  const modeValue = String(source.mode ?? "").toLowerCase();
  const mode: RuleConfigAuthorityMode = modeValue === "custom" || modeValue === "generated" || modeValue === "default" ? modeValue : "unknown";
  return {
    mode,
    isDefault: typeof source.is_default === "boolean" ? source.is_default : typeof source.isDefault === "boolean" ? source.isDefault : mode === "default" || mode === "generated",
    activePath: String(source.active_path ?? source.activePath ?? ""),
    activeName: String(source.active_name ?? source.activeName ?? ""),
    runtimePath: String(source.runtime_path ?? source.runtimePath ?? DEFAULT_RULE_AUTHORITY.runtimePath),
    canEditRules: typeof source.can_edit_rules === "boolean" ? source.can_edit_rules : typeof source.canEditRules === "boolean" ? source.canEditRules : mode === "custom",
    canEditRuleProviders: typeof source.can_edit_rule_providers === "boolean" ? source.can_edit_rule_providers : typeof source.canEditRuleProviders === "boolean" ? source.canEditRuleProviders : mode === "custom",
  };
}
