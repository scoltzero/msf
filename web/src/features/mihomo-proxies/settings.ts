import {
  DEFAULT_PROXY_TEST_URL,
  DEFAULT_PROXY_TIMEOUT_MS,
  type ProxyPageSettings,
  type ProxySortMode,
} from "./types";

/**
 * The storage key name is kept for compatibility with the v2 implementation.
 * The `version` field inside the value is the schema version and is now 3.
 */
export const PROXY_SETTINGS_KEY_V1 = "msf-mihomo-proxies.settings";
export const PROXY_SETTINGS_KEY_V2 = "msf-mihomo-proxies.settings.v2";
export const PROXY_SETTINGS_VERSION = 3 as const;

const DEFAULT_DELAY_LOW_MS = 400;
const DEFAULT_DELAY_HIGH_MS = 800;
const DEFAULT_MIN_PROXY_CARD_WIDTH = 145;
const MIN_DELAY_TIMEOUT_MS = 1_000;
const MAX_DELAY_TIMEOUT_MS = 120_000;
const MIN_PROXY_CARD_WIDTH = 96;
const MAX_PROXY_CARD_WIDTH = 640;
const MIN_GROUP_ICON_SIZE = 12;
const MAX_GROUP_ICON_SIZE = 64;
const MIN_GROUP_ICON_MARGIN = 0;
const MAX_GROUP_ICON_MARGIN = 32;

export const DEFAULT_PROXY_SETTINGS: ProxyPageSettings = {
  version: PROXY_SETTINGS_VERSION,
  groupProxiesByProvider: false,
  hideUnavailable: false,
  showHiddenProxies: false,
  manageHiddenGroups: false,
  autoDisconnectOnSwitch: true,
  displayFinalOutbound: false,
  disableProxiesPageTextSelect: true,
  minProxyCardWidth: DEFAULT_MIN_PROXY_CARD_WIDTH,
  doubleColumn: true,
  delayTestUrl: DEFAULT_PROXY_TEST_URL,
  delayTimeoutMs: DEFAULT_PROXY_TIMEOUT_MS,
  // These values colour delay badges for existing cards. They are retained for
  // compatibility with v2, but are deliberately not exposed as form controls.
  delayLowMs: DEFAULT_DELAY_LOW_MS,
  delayHighMs: DEFAULT_DELAY_HIGH_MS,
  sortBy: "default",
  nodeNameDisplay: "truncate",
  displayGlobalByMode: true,
  proxyPreviewType: "auto",
  proxyCardSize: "comfortable",
  proxyGroupIconSize: 24,
  proxyGroupIconMargin: 12,
  groupOrder: [],
  hiddenGroups: [],
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SettingsInput = Partial<ProxyPageSettings> & Record<string, unknown>;
type CanonicalSettingKey = keyof ProxyPageSettings;

const CANONICAL_KEYS: CanonicalSettingKey[] = [
  "version",
  "groupProxiesByProvider",
  "hideUnavailable",
  "showHiddenProxies",
  "manageHiddenGroups",
  "autoDisconnectOnSwitch",
  "displayFinalOutbound",
  "disableProxiesPageTextSelect",
  "minProxyCardWidth",
  "doubleColumn",
  "delayTestUrl",
  "delayTimeoutMs",
  "delayLowMs",
  "delayHighMs",
  "sortBy",
  "nodeNameDisplay",
  "displayGlobalByMode",
  "proxyPreviewType",
  "proxyCardSize",
  "proxyGroupIconSize",
  "proxyGroupIconMargin",
  "groupOrder",
  "hiddenGroups",
];

function freshDefaults(): ProxyPageSettings {
  return {
    ...DEFAULT_PROXY_SETTINGS,
    groupOrder: [],
    hiddenGroups: [],
  };
}

function numeric(
  value: unknown,
  fallback: number,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      ),
    ),
  );
}

function sortMode(value: unknown): ProxySortMode {
  const supported: ProxySortMode[] = [
    "default",
    "name-asc",
    "name-desc",
    "delay-asc",
    "delay-desc",
    "type",
  ];
  return typeof value === "string" && supported.includes(value as ProxySortMode)
    ? (value as ProxySortMode)
    : "default";
}

function httpUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

function firstDefined(source: SettingsInput, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function proxyCardSize(value: unknown): ProxyPageSettings["proxyCardSize"] {
  // v2 had no explicit size. Accept Zashboard's small/large labels as aliases
  // so importing a dashboard settings export remains lossless.
  if (value === "compact" || value === "small") return "compact";
  if (value === "comfortable" || value === "large") return "comfortable";
  return DEFAULT_PROXY_SETTINGS.proxyCardSize;
}

function previewType(value: unknown): ProxyPageSettings["proxyPreviewType"] {
  return value === "dots" || value === "bar" || value === "auto"
    ? value
    : DEFAULT_PROXY_SETTINGS.proxyPreviewType;
}

/**
 * Normalize any known v1/v2/v3 shape into the current schema.
 *
 * Legacy aliases intentionally live here rather than in React components. This
 * keeps migration deterministic and lets non-browser tests exercise malformed
 * localStorage values without rendering the page.
 */
export function normalizeProxySettings(input: unknown): ProxyPageSettings {
  const source = input && typeof input === "object" ? (input as SettingsInput) : {};
  const defaults = freshDefaults();
  const oldUrl = firstDefined(source, "delayTestUrl", "testUrl", "delay_test_url", "url");
  const oldOrder = firstDefined(source, "groupOrder", "groupsOrder", "order");
  const oldHidden = firstDefined(source, "hiddenGroups", "hidden_groups");

  const low = numeric(
    firstDefined(source, "delayLowMs", "delay_low_ms"),
    defaults.delayLowMs,
    0,
    60_000,
  );
  const high = Math.max(
    low,
    numeric(
      firstDefined(source, "delayHighMs", "delay_high_ms"),
      defaults.delayHighMs,
      0,
      120_000,
    ),
  );

  return {
    version: PROXY_SETTINGS_VERSION,
    groupProxiesByProvider: bool(
      firstDefined(source, "groupProxiesByProvider", "groupByProvider", "providerGrouped"),
      defaults.groupProxiesByProvider,
    ),
    hideUnavailable: bool(source.hideUnavailable, defaults.hideUnavailable),
    showHiddenProxies: bool(source.showHiddenProxies, defaults.showHiddenProxies),
    manageHiddenGroups: bool(
      firstDefined(source, "manageHiddenGroups", "manageHiddenGroup", "manageHiddenGroupMode"),
      defaults.manageHiddenGroups,
    ),
    autoDisconnectOnSwitch: bool(
      source.autoDisconnectOnSwitch,
      defaults.autoDisconnectOnSwitch,
    ),
    displayFinalOutbound: bool(
      firstDefined(source, "displayFinalOutbound", "showSelectedForNowNode", "showFinalOutbound"),
      defaults.displayFinalOutbound,
    ),
    disableProxiesPageTextSelect: bool(
      firstDefined(source, "disableProxiesPageTextSelect", "disableTextSelect"),
      defaults.disableProxiesPageTextSelect,
    ),
    minProxyCardWidth: numeric(
      firstDefined(source, "minProxyCardWidth", "minNodeCardWidth"),
      defaults.minProxyCardWidth,
      MIN_PROXY_CARD_WIDTH,
      MAX_PROXY_CARD_WIDTH,
    ),
    doubleColumn: bool(source.doubleColumn, defaults.doubleColumn),
    delayTestUrl: httpUrl(oldUrl, defaults.delayTestUrl),
    delayTimeoutMs: numeric(
      firstDefined(source, "delayTimeoutMs", "delay_timeout_ms", "timeoutMs"),
      defaults.delayTimeoutMs,
      MIN_DELAY_TIMEOUT_MS,
      MAX_DELAY_TIMEOUT_MS,
    ),
    delayLowMs: low,
    delayHighMs: high,
    sortBy: sortMode(firstDefined(source, "sortBy", "sort")),
    nodeNameDisplay: firstDefined(source, "nodeNameDisplay", "nodeDisplay") === "wrap" ? "wrap" : "truncate",
    displayGlobalByMode: bool(
      firstDefined(source, "displayGlobalByMode", "globalByMode"),
      defaults.displayGlobalByMode,
    ),
    proxyPreviewType: previewType(firstDefined(source, "proxyPreviewType", "nodePreviewType")),
    proxyCardSize: proxyCardSize(firstDefined(source, "proxyCardSize", "nodeCardSize")),
    proxyGroupIconSize: numeric(
      firstDefined(source, "proxyGroupIconSize", "groupIconSize"),
      defaults.proxyGroupIconSize,
      MIN_GROUP_ICON_SIZE,
      MAX_GROUP_ICON_SIZE,
    ),
    proxyGroupIconMargin: numeric(
      firstDefined(source, "proxyGroupIconMargin", "groupIconMargin", "proxyGroupIconSpacing"),
      defaults.proxyGroupIconMargin,
      MIN_GROUP_ICON_MARGIN,
      MAX_GROUP_ICON_MARGIN,
    ),
    groupOrder: stringArray(oldOrder),
    hiddenGroups: stringArray(oldHidden),
  };
}

function valueMatchesSource(source: SettingsInput, key: CanonicalSettingKey, settings: ProxyPageSettings): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return false;
  const sourceValue = source[key];
  const normalizedValue = settings[key];
  return JSON.stringify(sourceValue) === JSON.stringify(normalizedValue);
}

/** Return normalized settings and whether storage should be rewritten. */
export function migrateProxySettings(input: unknown): { settings: ProxyPageSettings; migrated: boolean } {
  const source = input && typeof input === "object" ? (input as SettingsInput) : {};
  const settings = normalizeProxySettings(source);
  const migrated =
    Number(source.version) !== PROXY_SETTINGS_VERSION ||
    CANONICAL_KEYS.some((key) => !valueMatchesSource(source, key, settings));
  return { settings, migrated };
}

function defaultStorage(): StorageLike | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function safeSet(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and quota errors should not break page rendering.
  }
}

function safeRemove(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

export function readProxySettings(storage: StorageLike | undefined = defaultStorage()): ProxyPageSettings {
  if (!storage) return freshDefaults();

  let rawV2: string | null = null;
  try {
    rawV2 = storage.getItem(PROXY_SETTINGS_KEY_V2);
  } catch {
    return freshDefaults();
  }

  if (rawV2) {
    try {
      const migrated = migrateProxySettings(JSON.parse(rawV2));
      if (migrated.migrated) safeSet(storage, PROXY_SETTINGS_KEY_V2, migrated.settings);
      return migrated.settings;
    } catch {
      // Fall through to the v1 reader and repair the value below.
    }
  }

  let rawV1: string | null = null;
  try {
    rawV1 = storage.getItem(PROXY_SETTINGS_KEY_V1);
  } catch {
    return freshDefaults();
  }

  if (rawV1) {
    try {
      const migrated = migrateProxySettings(JSON.parse(rawV1));
      safeSet(storage, PROXY_SETTINGS_KEY_V2, migrated.settings);
      safeRemove(storage, PROXY_SETTINGS_KEY_V1);
      return migrated.settings;
    } catch {
      // Continue to the canonical defaults below.
    }
  }

  const defaults = freshDefaults();
  if (rawV2) safeSet(storage, PROXY_SETTINGS_KEY_V2, defaults);
  return defaults;
}

export function writeProxySettings(
  settings: Partial<ProxyPageSettings>,
  storage: StorageLike | undefined = defaultStorage(),
): ProxyPageSettings {
  const normalized = normalizeProxySettings(settings);
  if (storage) safeSet(storage, PROXY_SETTINGS_KEY_V2, normalized);
  return normalized;
}

export function resetProxySettings(
  storage: StorageLike | undefined = defaultStorage(),
): ProxyPageSettings {
  const defaults = freshDefaults();
  if (storage) safeSet(storage, PROXY_SETTINGS_KEY_V2, defaults);
  return defaults;
}

export const readSettings = readProxySettings;
export const writeSettings = writeProxySettings;
