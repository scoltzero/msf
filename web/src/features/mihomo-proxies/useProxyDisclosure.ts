import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DisclosureKind = "group" | "provider";
export type ProxyTab = "groups" | "providers";

/** The unversioned key is kept as a migration source for older page builds. */
export const PROXY_TAB_KEY = "msf-mihomo-proxies.tab";
export const PROXY_TAB_KEY_V2 = "msf-mihomo-proxies.tab.v2";
export const COLLAPSE_PREFIX_V1 = "msf-mihomo-proxies.collapse";
export const COLLAPSE_PREFIX_V2 = "msf-mihomo-proxies.collapse.v2";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CollapsedState = Record<DisclosureKind, Record<string, boolean>>;

function isStorage(value: StorageLike | undefined): value is StorageLike {
  return Boolean(value && typeof value.getItem === "function" && typeof value.setItem === "function");
}

function defaultStorage(): StorageLike | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function normalizeKeys(keys: readonly string[] | undefined): string[] {
  return Array.from(new Set((keys || []).filter((key): key is string => typeof key === "string" && key.length > 0)));
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value !== "string") return undefined;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return undefined;
}

function itemKey(prefix: string, kind: DisclosureKind, key: string): string {
  return `${prefix}.${kind}.${key}`;
}

function readJson(storage: StorageLike | undefined, key: string): unknown {
  if (!isStorage(storage)) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readRaw(storage: StorageLike | undefined, key: string): string | null {
  if (!isStorage(storage)) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | undefined, key: string, value: string): void {
  if (!isStorage(storage)) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing or when quota is exceeded.
  }
}

function safeRemove(storage: StorageLike | undefined, key: string): void {
  if (!isStorage(storage) || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(key);
  } catch {
    // Best effort only; the in-memory state remains authoritative for this render.
  }
}

function readObjectValue(storage: StorageLike | undefined, prefix: string, kind: DisclosureKind, key: string): boolean | undefined {
  const root = readJson(storage, prefix);
  if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
  const record = root as Record<string, unknown>;
  const byKind = record[kind] ?? record[`${kind}s`];
  if (!byKind || typeof byKind !== "object" || Array.isArray(byKind)) return undefined;
  return parseBool((byKind as Record<string, unknown>)[key]);
}

/**
 * Read one persisted item. Missing values deliberately default to collapsed so a
 * newly discovered group/provider does not expand an entire page on first load.
 */
export function readCollapsed(
  kind: DisclosureKind,
  key: string,
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  const versioned = parseBool(readRaw(storage, itemKey(COLLAPSE_PREFIX_V2, kind, key)))
    ?? readObjectValue(storage, COLLAPSE_PREFIX_V2, kind, key);
  if (versioned !== undefined) return versioned;
  const legacy = parseBool(readRaw(storage, itemKey(COLLAPSE_PREFIX_V1, kind, key)))
    ?? readObjectValue(storage, COLLAPSE_PREFIX_V1, kind, key);
  return legacy ?? true;
}

/**
 * Copy legacy collapse entries to the v2 namespace. The old keys are removed
 * only after the v2 value is written, making this migration safe to retry.
 */
export function migrateProxyCollapseStorage(
  keys: Partial<Record<DisclosureKind, readonly string[]>> = {},
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!isStorage(storage)) return;
  (Object.keys(keys) as DisclosureKind[]).forEach((kind) => {
    normalizeKeys(keys[kind]).forEach((key) => {
      const versionedKey = itemKey(COLLAPSE_PREFIX_V2, kind, key);
      const legacyKey = itemKey(COLLAPSE_PREFIX_V1, kind, key);
      if (readRaw(storage, versionedKey) != null) return;
      const legacyRaw = readRaw(storage, legacyKey);
      const legacyValue = parseBool(legacyRaw) ?? readObjectValue(storage, COLLAPSE_PREFIX_V1, kind, key);
      if (legacyValue === undefined) return;
      safeSet(storage, versionedKey, legacyValue ? "1" : "0");
      safeRemove(storage, legacyKey);
    });
  });
}

function hydrateState(
  keys: Partial<Record<DisclosureKind, readonly string[]>>,
  storage: StorageLike | undefined,
): CollapsedState {
  const next: CollapsedState = { group: {}, provider: {} };
  (Object.keys(next) as DisclosureKind[]).forEach((kind) => {
    normalizeKeys(keys[kind]).forEach((key) => {
      next[kind][key] = readCollapsed(kind, key, storage);
    });
  });
  return next;
}

function sameKeys(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = normalizeKeys(left);
  const b = normalizeKeys(right);
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

export type ProxyDisclosureOptions = {
  groupKeys?: readonly string[];
  providerKeys?: readonly string[];
  storage?: StorageLike;
};

export type ProxyDisclosure = {
  tab: ProxyTab;
  setTab: (value: ProxyTab) => void;
  collapsed: (kind: DisclosureKind, key: string) => boolean;
  setCollapsed: (kind: DisclosureKind, key: string, value: boolean) => void;
  toggleCollapse: (kind: DisclosureKind, key: string) => void;
  allCollapsed: (kind: DisclosureKind, keys: readonly string[]) => boolean;
  setAllCollapsed: (kind: DisclosureKind, keys: readonly string[], value?: boolean) => void;
};

/** Persist page-level tab and per-item disclosure state while keeping renders synchronous. */
export function useProxyDisclosure(options: ProxyDisclosureOptions = {}): ProxyDisclosure {
  const storage = useMemo(() => options.storage ?? defaultStorage(), [options.storage]);
  const groupKeys = options.groupKeys || [];
  const providerKeys = options.providerKeys || [];
  const [tab, setTabState] = useState<ProxyTab>(() => readProxyTab(storage));
  const [state, setState] = useState<CollapsedState>(() => hydrateState({ group: groupKeys, provider: providerKeys }, storage));
  const stateRef = useRef(state);
  const keySignature = `${normalizeKeys(groupKeys).join("\u0000")}\u0001${normalizeKeys(providerKeys).join("\u0000")}`;
  const previousKeysRef = useRef({ group: normalizeKeys(groupKeys), provider: normalizeKeys(providerKeys) });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    migrateProxyCollapseStorage({ group: groupKeys, provider: providerKeys }, storage);
    const previous = previousKeysRef.current;
    if (sameKeys(previous.group, groupKeys) && sameKeys(previous.provider, providerKeys)) return;
    previousKeysRef.current = { group: normalizeKeys(groupKeys), provider: normalizeKeys(providerKeys) };
    setState((current) => {
      const next: CollapsedState = { group: { ...current.group }, provider: { ...current.provider } };
      let changed = false;
      (Object.keys(next) as DisclosureKind[]).forEach((kind) => {
        normalizeKeys(kind === "group" ? groupKeys : providerKeys).forEach((key) => {
          if (next[kind][key] !== undefined) return;
          next[kind][key] = readCollapsed(kind, key, storage);
          changed = true;
        });
      });
      return changed ? next : current;
    });
  // The signature is intentionally based on values, not array identity: runtime
  // snapshots create fresh arrays on each refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, storage]);

  const setTab = useCallback((value: ProxyTab) => {
    setTabState(value);
    safeSet(storage, PROXY_TAB_KEY_V2, value);
    // Keep the original key in sync for older page bundles opened in another tab.
    safeSet(storage, PROXY_TAB_KEY, value);
  }, [storage]);

  const collapsed = useCallback((kind: DisclosureKind, key: string) => {
    const value = stateRef.current[kind][key];
    return value === undefined ? readCollapsed(kind, key, storage) : value;
  }, [storage]);

  const setCollapsed = useCallback((kind: DisclosureKind, key: string, value: boolean) => {
    const next: CollapsedState = {
      group: { ...stateRef.current.group },
      provider: { ...stateRef.current.provider },
    };
    next[kind][key] = value;
    stateRef.current = next;
    setState(next);
    safeSet(storage, itemKey(COLLAPSE_PREFIX_V2, kind, key), value ? "1" : "0");
    safeRemove(storage, itemKey(COLLAPSE_PREFIX_V1, kind, key));
  }, [storage]);

  const toggleCollapse = useCallback((kind: DisclosureKind, key: string) => {
    setCollapsed(kind, key, !collapsed(kind, key));
  }, [collapsed, setCollapsed]);

  const allCollapsed = useCallback((kind: DisclosureKind, keys: readonly string[]) => {
    const normalized = normalizeKeys(keys);
    return normalized.length > 0 && normalized.every((key) => collapsed(kind, key));
  }, [collapsed]);

  const setAllCollapsed = useCallback((kind: DisclosureKind, keys: readonly string[], value?: boolean) => {
    const normalized = normalizeKeys(keys);
    if (normalized.length === 0) return;
    const nextValue = value ?? !allCollapsed(kind, normalized);
    const next: CollapsedState = {
      group: { ...stateRef.current.group },
      provider: { ...stateRef.current.provider },
    };
    normalized.forEach((key) => { next[kind][key] = nextValue; });
    stateRef.current = next;
    setState(next);
    normalized.forEach((key) => {
      safeSet(storage, itemKey(COLLAPSE_PREFIX_V2, kind, key), nextValue ? "1" : "0");
      safeRemove(storage, itemKey(COLLAPSE_PREFIX_V1, kind, key));
    });
  }, [allCollapsed, storage]);

  return { tab, setTab, collapsed, setCollapsed, toggleCollapse, allCollapsed, setAllCollapsed };
}

export function readProxyTab(storage: StorageLike | undefined = defaultStorage()): ProxyTab {
  const versioned = readRaw(storage, PROXY_TAB_KEY_V2);
  const legacy = readRaw(storage, PROXY_TAB_KEY);
  const value = versioned === "providers" || versioned === "groups" ? versioned : legacy;
  const tab: ProxyTab = value === "providers" ? "providers" : "groups";
  if (legacy && !versioned) safeSet(storage, PROXY_TAB_KEY_V2, tab);
  return tab;
}
