import { api } from "@/lib/api";
import { normalizeProxySnapshot } from "./normalize";
import type { ProxyKey, ProxyProvider, ProxyStore, ProxyTestPolicy } from "./types";

export type ProxyApiTransport = <T>(path: string, options?: RequestInit) => Promise<T>;

export type ProxyDelayResult = {
  key?: ProxyKey;
  name?: string;
  delay: number;
  url?: string;
  testedAt?: string;
  source?: ProxyTestPolicy["source"];
};

export type ProxyGroupDelayResult = {
  group: string;
  delays: Record<string, number>;
  testedAt?: string;
  url?: string;
};

export type ProxyDisconnectResult = {
  matched: number;
  closed: number;
  failedIds: string[];
};

export type ProxyRuntimeRequests = {
  proxies?: unknown;
  overview?: unknown;
  providers?: unknown;
  authority?: unknown;
};

export type ProxyRuntimeLoadResult = {
  store: ProxyStore;
  responses: ProxyRuntimeRequests;
  errors: Error[];
};

function dataOf(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) return (value as { data?: unknown }).data;
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pathPart(value: string): string {
  return encodeURIComponent(value);
}

function unwrapDelay(value: unknown): ProxyDelayResult {
  const root = record(value);
  const row = record(root?.data) ?? root ?? {};
  return {
    name: text(row.name),
    delay: numberValue(row.delay),
    url: text(row.url),
    testedAt: text(row.tested_at ?? row.testedAt),
    source: text(row.source) as ProxyTestPolicy["source"] | undefined,
  };
}

function unwrapGroupDelay(value: unknown, group: string): ProxyGroupDelayResult {
  const root = record(value);
  const row = record(root?.data) ?? root ?? {};
  const raw = record(row.delays) ?? {};
  const delays: Record<string, number> = {};
  for (const [name, delay] of Object.entries(raw)) delays[name] = numberValue(delay);
  return { group: text(row.group) ?? group, delays, testedAt: text(row.tested_at ?? row.testedAt), url: text(row.url) };
}

function unwrapDisconnect(value: unknown): ProxyDisconnectResult {
  const root = record(value);
  const row = record(root?.data) ?? root ?? {};
  const failed = Array.isArray(row.failed_ids) ? row.failed_ids : Array.isArray(row.failedIds) ? row.failedIds : [];
  return { matched: numberValue(row.matched), closed: numberValue(row.closed), failedIds: failed.filter((item): item is string => typeof item === "string") };
}

export class ProxyApiError extends Error {
  readonly status?: number;
  readonly payload?: unknown;

  constructor(message: string, status?: number, payload?: unknown) {
    super(message);
    this.name = "ProxyApiError";
    this.status = status;
    this.payload = payload;
  }
}

export type ProxyApi = ReturnType<typeof createProxyApi>;

export function createProxyApi(transport: ProxyApiTransport = api): {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  loadRuntime(previous?: ProxyStore, signal?: AbortSignal): Promise<ProxyRuntimeLoadResult>;
  getProxies(signal?: AbortSignal): Promise<unknown>;
  getOverview(signal?: AbortSignal): Promise<unknown>;
  getProviders(signal?: AbortSignal): Promise<unknown>;
  getConfigAuthority(signal?: AbortSignal): Promise<unknown>;
  selectProxy(groupName: string, proxyName: string, signal?: AbortSignal): Promise<unknown>;
  delayProxy(proxyName: string, policy: ProxyTestPolicy, signal?: AbortSignal): Promise<ProxyDelayResult>;
  delayGroup(groupName: string, policy: ProxyTestPolicy, signal?: AbortSignal): Promise<ProxyGroupDelayResult>;
  delayProviderProxy(providerName: string, proxyName: string, policy: ProxyTestPolicy, signal?: AbortSignal): Promise<ProxyDelayResult>;
  updateProvider(providerName: string, signal?: AbortSignal): Promise<unknown>;
  healthcheckProvider(providerName: string, policy?: ProxyTestPolicy, signal?: AbortSignal): Promise<unknown>;
  disconnectProxyGroup(groupName: string, signal?: AbortSignal): Promise<ProxyDisconnectResult>;
} {
  const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    try {
      return await transport<T>(path, options);
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new ProxyApiError("代理请求失败", undefined, error);
    }
  };

  const get = (path: string, signal?: AbortSignal) => request<unknown>(path, signal ? { signal } : undefined);
  const policyQuery = (policy: ProxyTestPolicy) => `?url=${encodeURIComponent(policy.url)}&timeout=${encodeURIComponent(String(policy.timeoutMs))}`;

  return {
    request,
    async loadRuntime(previous, signal) {
      const entries: Array<readonly [keyof ProxyRuntimeRequests, Promise<unknown>]> = [
        ["proxies", get("/api/v1/mihomo/proxies", signal)],
        ["overview", get("/api/v1/mihomo/overview", signal)],
        ["providers", get("/api/v1/mihomo/proxy-providers", signal)],
        ["authority", get("/api/v1/mihomo/config/mode", signal)],
      ];
      const settled = await Promise.allSettled(entries.map(([, promise]) => promise));
      const responses: ProxyRuntimeRequests = {};
      const errors: Error[] = [];
      settled.forEach((result, index) => {
        const key = entries[index][0];
        if (result.status === "fulfilled") responses[key] = result.value;
        else if (result.reason instanceof Error) errors.push(result.reason);
        else errors.push(new ProxyApiError("代理数据请求失败", undefined, result.reason));
      });
      const combined = {
        data: {
          ...(record(dataOf(responses.proxies)) ?? {}),
          overview: dataOf(responses.overview),
          providers: dataOf(responses.providers),
          config_authority: dataOf(responses.authority),
        },
      };
      return { store: normalizeProxySnapshot(combined, previous), responses, errors };
    },
    getProxies: (signal) => get("/api/v1/mihomo/proxies", signal),
    getOverview: (signal) => get("/api/v1/mihomo/overview", signal),
    getProviders: (signal) => get("/api/v1/mihomo/proxy-providers", signal),
    getConfigAuthority: (signal) => get("/api/v1/mihomo/config/mode", signal),
    selectProxy: (groupName, proxyName, signal) =>
      request(`/api/v1/mihomo/proxies/${pathPart(groupName)}`, {
        method: "PUT",
        body: JSON.stringify({ name: proxyName }),
        ...(signal ? { signal } : {}),
      }),
    async delayProxy(proxyName, policy, signal) {
      const payload = await get(`/api/v1/mihomo/proxies/${pathPart(proxyName)}/delay${policyQuery(policy)}`, signal);
      return { ...unwrapDelay(payload), name: proxyName, url: policy.url, source: policy.source };
    },
    async delayGroup(groupName, policy, signal) {
      const payload = await get(`/api/v1/mihomo/proxy-groups/${pathPart(groupName)}/delay${policyQuery(policy)}`, signal);
      return { ...unwrapGroupDelay(payload, groupName), url: policy.url };
    },
    async delayProviderProxy(providerName, proxyName, policy, signal) {
      const payload = await get(`/api/v1/mihomo/proxy-providers/${pathPart(providerName)}/proxies/${pathPart(proxyName)}/delay${policyQuery(policy)}`, signal);
      return { ...unwrapDelay(payload), name: proxyName, url: policy.url, source: policy.source };
    },
    updateProvider: (providerName, signal) => request(`/api/v1/mihomo/proxy-providers/${pathPart(providerName)}/update`, { method: "POST", ...(signal ? { signal } : {}) }),
    healthcheckProvider: (providerName, policy, signal) =>
      request(`/api/v1/mihomo/proxy-providers/${pathPart(providerName)}/healthcheck`, {
        method: "POST",
        ...(policy ? { body: JSON.stringify({ url: policy.url, timeout: policy.timeoutMs }) } : {}),
        ...(signal ? { signal } : {}),
      }),
    async disconnectProxyGroup(groupName, signal) {
      const payload = await request<unknown>(`/api/v1/mihomo/proxies/${pathPart(groupName)}/connections`, { method: "DELETE", ...(signal ? { signal } : {}) });
      return unwrapDisconnect(payload);
    },
  };
}

export const proxyApi = createProxyApi();
