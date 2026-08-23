import { useCallback, useEffect, useRef, useState } from "react";
import { mergeRuleStore, patchProvider, patchRule } from "./ruleStore";
import { normalizeRuleProviders } from "./normalize";
import { ruleApi, type RuleApi } from "./ruleApi";
import { createEmptyRuleStore, type RuleRuntimeSnapshot, type RuleStore, type RuleToggleResult } from "./types";

export type RuleRuntimeOptions = {
  api?: RuleApi;
  enabled?: boolean;
  autoRefreshMs?: number;
  initialStore?: RuleStore;
};

export type RuleRefreshOptions = { silent?: boolean };

export type RuleRuntime = Omit<RuleRuntimeSnapshot, "store"> & {
  store: RuleStore;
  refresh(options?: RuleRefreshOptions): Promise<RuleStore | undefined>;
  toggleRule(id: string, disabled: boolean, disconnectMatched?: boolean): Promise<RuleToggleResult>;
  selectProxy(groupName: string, proxyName: string): Promise<void>;
  updateProvider(name: string): Promise<unknown>;
  clearError(): void;
};

export function useRuleRuntime(options: RuleRuntimeOptions = {}): RuleRuntime {
  const client = options.api ?? ruleApi;
  const enabled = options.enabled !== false;
  const refreshInterval = Math.max(0, options.autoRefreshMs ?? 30_000);
  const [store, setStore] = useState<RuleStore>(() => options.initialStore ?? createEmptyRuleStore());
  const [loading, setLoading] = useState(() => !options.initialStore || options.initialStore.rules.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [visible, setVisible] = useState(true);
  const storeRef = useRef(store);
  const sequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => { storeRef.current = store; }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async ({ silent = false }: RuleRefreshOptions = {}): Promise<RuleStore | undefined> => {
    if (!enabled || (typeof document !== "undefined" && document.hidden)) return undefined;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const sequence = ++sequenceRef.current;
    const revisionAtStart = revisionRef.current;
    const hadData = storeRef.current.rules.length > 0 || storeRef.current.providerNames.length > 0;
    if (!silent && !hadData) setLoading(true);
    else setRefreshing(true);
    try {
      const loaded = await client.loadRuntime(storeRef.current, controller.signal);
      if (!mountedRef.current || controller.signal.aborted || sequence !== sequenceRef.current || revisionAtStart !== revisionRef.current) return undefined;
      const next = mergeRuleStore(storeRef.current, loaded.store);
      storeRef.current = next;
      setStore(next);
      if (loaded.errors.length) setError(loaded.errors.map((item) => item.message).join("；"));
      else setError(undefined);
      return next;
    } catch (reason) {
      if (!mountedRef.current || controller.signal.aborted || sequence !== sequenceRef.current) return undefined;
      setError(reason instanceof Error ? reason.message : "规则数据加载失败");
      return undefined;
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh({ silent: Boolean(options.initialStore) });
    if (refreshInterval <= 0) return undefined;
    const timer = window.setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void refresh({ silent: true });
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [enabled, options.initialStore, refresh, refreshInterval]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (nextVisible) void refresh({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  const toggleRule = useCallback(async (id: string, disabled: boolean, disconnectMatched = false): Promise<RuleToggleResult> => {
    const before = storeRef.current;
    const current = before.rules.find((rule) => rule.id === id);
    if (!current) throw new Error("规则不存在");
    const optimistic = patchRule(before, id, { disabled });
    revisionRef.current += 1;
    storeRef.current = optimistic;
    setStore(optimistic);
    try {
      const result = await client.toggleRule(current, disabled, disconnectMatched);
      const committed = patchRule(storeRef.current, id, { disabled: result.disabled });
      storeRef.current = committed;
      setStore(committed);
      return result;
    } catch (reason) {
      if (mountedRef.current) {
        const code = reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code) : "";
        const reverted = code === "rule_toggle_unsupported"
          ? { ...before, capabilities: { ...before.capabilities, ruleToggle: false } }
          : before;
        storeRef.current = reverted;
        setStore(reverted);
      }
      throw reason;
    }
  }, [client]);

  const selectProxy = useCallback(async (groupName: string, proxyName: string): Promise<void> => {
    await client.selectProxy(groupName, proxyName);
    await refresh({ silent: true });
  }, [client, refresh]);

  const updateProvider = useCallback(async (name: string): Promise<unknown> => {
    const current = storeRef.current.providers[name];
    if (!current) throw new Error("规则提供商不存在");
    const updating = patchProvider(storeRef.current, name, { updating: true, lastUpdateError: undefined });
    storeRef.current = updating;
    setStore(updating);
    try {
      const result = await client.updateProvider(name);
      const latest = await client.getProvider(name);
      const normalized = normalizeRuleProviders({ items: [latest] })[name];
      if (normalized) {
        const committed = patchProvider(storeRef.current, name, { ...normalized, updating: false, usingStaleCache: false, lastUpdateError: undefined });
        storeRef.current = committed;
        setStore(committed);
      } else {
        const committed = patchProvider(storeRef.current, name, { updating: false });
        storeRef.current = committed;
        setStore(committed);
      }
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "更新失败，正在使用旧缓存";
      const failed = patchProvider(storeRef.current, name, { updating: false, lastUpdateError: message, usingStaleCache: true });
      storeRef.current = failed;
      setStore(failed);
      throw reason;
    }
  }, [client]);

  const clearError = useCallback(() => setError(undefined), []);

  return { store, loading, refreshing, error, visible, refresh, toggleRule, selectProxy, updateProvider, clearError };
}
