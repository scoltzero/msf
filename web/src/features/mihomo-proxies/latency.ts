import {
  DEFAULT_PROXY_TEST_URL,
  DEFAULT_PROXY_TIMEOUT_MS,
  type ProxyEntity,
  type ProxyGroupTestPolicy,
  type ProxyKey,
  type ProxyProvider,
  type ProxyStore,
  type ProxyTestJob,
  type ProxyTestPolicy,
  type ProxyTestJobScope,
} from "./types";

export type ProxyPolicySource = string | Partial<ProxyTestPolicy> | ProxyGroupTestPolicy | undefined;

export type ResolveProxyTestPolicyInput = {
  scope?: "node" | "group" | "provider" | "provider-healthcheck";
  temporary?: ProxyPolicySource;
  group?: ProxyPolicySource;
  provider?: ProxyPolicySource;
  pageFallback?: ProxyPolicySource;
  systemDefault?: ProxyPolicySource;
  sourceName?: string;
};

export type ProxyTestBucket = {
  policy: ProxyTestPolicy;
  keys: ProxyKey[];
};

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function toPolicy(value: ProxyPolicySource, source: ProxyTestPolicy["source"], sourceName?: string): ProxyTestPolicy | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const url = value.trim();
    if (!url) return undefined;
    return { url, timeoutMs: DEFAULT_PROXY_TIMEOUT_MS, source, sourceName, persisted: source !== "temporary" && source !== "page-fallback" };
  }
  const row = valueRecord(value);
  if (!row) return undefined;
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!url) return undefined;
  const timeoutRaw = row.timeoutMs ?? row.timeout;
  const timeoutMs = typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) ? Math.max(1, timeoutRaw) : DEFAULT_PROXY_TIMEOUT_MS;
  return { url, timeoutMs, source, sourceName: typeof row.sourceName === "string" ? row.sourceName : sourceName, persisted: source !== "temporary" && source !== "page-fallback" };
}

/** Resolve the four-layer policy in one place. */
export function resolveProxyTestPolicy(input: ResolveProxyTestPolicyInput): ProxyTestPolicy;
export function resolveProxyTestPolicy(
  temporary?: ProxyPolicySource,
  group?: ProxyPolicySource,
  provider?: ProxyPolicySource,
  pageFallback?: ProxyPolicySource,
  systemDefault?: ProxyPolicySource,
): ProxyTestPolicy;
export function resolveProxyTestPolicy(
  inputOrTemporary: ResolveProxyTestPolicyInput | ProxyPolicySource = {},
  positionalGroup?: ProxyPolicySource,
  positionalProvider?: ProxyPolicySource,
  positionalPageFallback?: ProxyPolicySource,
  positionalSystemDefault?: ProxyPolicySource,
): ProxyTestPolicy {
  const input: ResolveProxyTestPolicyInput =
    typeof inputOrTemporary === "object" && inputOrTemporary !== null && !Array.isArray(inputOrTemporary) &&
    ("temporary" in inputOrTemporary || "group" in inputOrTemporary || "provider" in inputOrTemporary || "scope" in inputOrTemporary || "pageFallback" in inputOrTemporary || "systemDefault" in inputOrTemporary)
      ? inputOrTemporary
      : {
          temporary: inputOrTemporary as ProxyPolicySource,
          group: positionalGroup,
          provider: positionalProvider,
          pageFallback: positionalPageFallback,
          systemDefault: positionalSystemDefault,
        };
  const scope = input.scope ?? "node";
  const sourceName = input.sourceName;
  const temporary = toPolicy(input.temporary, "temporary", sourceName);
  const group = toPolicy(input.group, "group-config", sourceName);
  const provider = toPolicy(input.provider, "provider-config", sourceName);
  const page = toPolicy(input.pageFallback, "page-fallback", sourceName);
  const system = toPolicy(input.systemDefault, "system-default", sourceName);
  if (temporary) return temporary;
  if (scope === "provider-healthcheck" && provider) return provider;
  if (scope === "provider" || scope === "provider-healthcheck") return provider ?? page ?? system ?? fallbackPolicy();
  return group ?? provider ?? page ?? system ?? fallbackPolicy();
}

function fallbackPolicy(): ProxyTestPolicy {
  return { url: DEFAULT_PROXY_TEST_URL, timeoutMs: DEFAULT_PROXY_TIMEOUT_MS, source: "page-fallback", persisted: false };
}

export function resolveNodeTestPolicy(
  node: ProxyEntity | undefined,
  group: ProxyEntity | undefined,
  provider: ProxyProvider | undefined,
  pageFallback?: ProxyPolicySource,
  systemDefault?: ProxyPolicySource,
  temporary?: ProxyPolicySource,
): ProxyTestPolicy {
  return resolveProxyTestPolicy({
    scope: "node",
    temporary,
    group: group?.testPolicy,
    provider: provider?.testPolicy ?? node?.testPolicy,
    pageFallback,
    systemDefault,
    sourceName: node?.name,
  });
}

export function resolveGroupTestPolicy(
  group: ProxyEntity | undefined,
  providerPolicies: readonly ProxyProvider[] = [],
  pageFallback?: ProxyPolicySource,
  systemDefault?: ProxyPolicySource,
  temporary?: ProxyPolicySource,
): ProxyTestPolicy {
  const firstProvider = providerPolicies.find((provider) => provider.testPolicy);
  return resolveProxyTestPolicy({
    scope: "group",
    temporary,
    group: group?.testPolicy,
    provider: firstProvider?.testPolicy,
    pageFallback,
    systemDefault,
    sourceName: group?.name,
  });
}

export function createProxyTestJob(scope: ProxyTestJobScope, total: number, id = `proxy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): ProxyTestJob {
  return { id, scope, status: total > 0 ? "queued" : "done", completed: 0, total: Math.max(0, total), succeeded: 0, failed: 0 };
}

export function updateProxyTestJob(job: ProxyTestJob, update: Partial<Pick<ProxyTestJob, "status" | "completed" | "succeeded" | "failed" | "error" | "startedAt" | "finishedAt">>): ProxyTestJob {
  const next = { ...job, ...update };
  if (next.completed >= next.total && next.status === "running") {
    next.status = "done";
    next.finishedAt = Date.now();
  }
  return next;
}

export function cancelProxyTestJob(job: ProxyTestJob): ProxyTestJob {
  return job.status === "done" ? job : { ...job, status: "cancelled", finishedAt: Date.now() };
}

export function bucketProxyTests(
  store: ProxyStore,
  groupKey: string,
  pageFallback?: ProxyPolicySource,
  systemDefault?: ProxyPolicySource,
  temporary?: ProxyPolicySource,
): ProxyTestBucket[] {
  const group = store.entities[groupKey as ProxyKey];
  if (!group || group.kind !== "group") return [];
  const buckets = new Map<string, ProxyTestBucket>();
  for (const key of group.memberKeys) {
    const node = store.entities[key];
    if (!node) continue;
    const provider = node.providerName ? store.providers[node.providerName] ?? Object.values(store.providers).find((item) => item.name === node.providerName) : undefined;
    const policy = resolveNodeTestPolicy(node, group, provider, pageFallback ?? store.pageTestPolicy, systemDefault, temporary);
    // Bucket by the effective request, not by where the URL came from. A
    // mixed group with the same URL can still use one native group-delay call.
    const bucketKey = `${policy.url}\u0000${policy.timeoutMs}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.keys.push(key);
    else buckets.set(bucketKey, { policy, keys: [key] });
  }
  return Array.from(buckets.values());
}

export type ControlledTestResult<K extends string, T> = { key: K; value?: T; error?: unknown };
export type ControlledTestOptions<K extends string = string> = {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (result: ControlledTestResult<K, unknown>, completed: number, total: number) => void;
};

/** Run node tests with a bounded worker pool; cancellation is cooperative. */
export async function runControlledTests<K extends string, T>(
  keys: readonly K[],
  test: (key: K, signal: AbortSignal) => Promise<T>,
  options: ControlledTestOptions<K> = {},
): Promise<ControlledTestResult<K, T>[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, keys.length || 1));
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const results: ControlledTestResult<K, T>[] = [];
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < keys.length && !signal.aborted) {
      const index = cursor;
      cursor += 1;
      const key = keys[index];
      try {
        const value = await test(key, signal);
        const result = { key, value };
        results.push(result);
        completed += 1;
        options.onProgress?.(result, completed, keys.length);
      } catch (error) {
        const result = { key, error };
        results.push(result);
        completed += 1;
        options.onProgress?.(result, completed, keys.length);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export function isTestJobActive(job: ProxyTestJob | undefined): boolean {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}
