import type { RuleSearchMode } from "./types";

export const RULE_SETTINGS_KEY = "msf-mihomo-rules.settings.v2";
export const RULE_SETTINGS_VERSION = 2 as const;

export type RulePageSettings = {
  version: 2;
  searchMode: RuleSearchMode;
  expandedRuleIds: string[];
  disconnectMatchedOnDisable: boolean;
  autoRefresh: boolean;
};

export const DEFAULT_RULE_SETTINGS: RulePageSettings = {
  version: RULE_SETTINGS_VERSION,
  searchMode: "plain",
  expandedRuleIds: [],
  disconnectMatchedOnDisable: false,
  autoRefresh: true,
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOf(storage?: StorageLike): StorageLike | undefined {
  if (storage) return storage;
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== ""))) : [];
}

export function normalizeRuleSettings(value: unknown): RulePageSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const mode = source.searchMode === "regex" || source.search_mode === "regex" ? "regex" : "plain";
  return {
    version: RULE_SETTINGS_VERSION,
    searchMode: mode,
    expandedRuleIds: strings(source.expandedRuleIds ?? source.expanded_rule_ids),
    disconnectMatchedOnDisable: typeof source.disconnectMatchedOnDisable === "boolean" ? source.disconnectMatchedOnDisable : typeof source.disconnect_matched_on_disable === "boolean" ? source.disconnect_matched_on_disable : false,
    autoRefresh: typeof source.autoRefresh === "boolean" ? source.autoRefresh : typeof source.auto_refresh === "boolean" ? source.auto_refresh : true,
  };
}

export function readRuleSettings(storage?: StorageLike): RulePageSettings {
  const target = storageOf(storage);
  if (!target) return { ...DEFAULT_RULE_SETTINGS, expandedRuleIds: [] };
  try {
    const raw = target.getItem(RULE_SETTINGS_KEY);
    return raw ? normalizeRuleSettings(JSON.parse(raw)) : { ...DEFAULT_RULE_SETTINGS, expandedRuleIds: [] };
  } catch {
    return { ...DEFAULT_RULE_SETTINGS, expandedRuleIds: [] };
  }
}

export function writeRuleSettings(value: RulePageSettings, storage?: StorageLike): void {
  const target = storageOf(storage);
  if (!target) return;
  try {
    target.setItem(RULE_SETTINGS_KEY, JSON.stringify(normalizeRuleSettings(value)));
  } catch {
    // A full/blocked localStorage must not prevent the runtime page loading.
  }
}

export function resetRuleSettings(storage?: StorageLike): RulePageSettings {
  const target = storageOf(storage);
  try { target?.removeItem(RULE_SETTINGS_KEY); } catch { /* ignored */ }
  return { ...DEFAULT_RULE_SETTINGS, expandedRuleIds: [] };
}
