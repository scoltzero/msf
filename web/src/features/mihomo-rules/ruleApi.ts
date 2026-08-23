import { api } from "@/lib/api";
import { normalizeRuleSnapshot } from "./normalize";
import type {
  RuleConfigDraft,
  RuleConfigSnapshot,
  RuleDisconnectResult,
  RuleRuntimeLoadResult,
  RuleStore,
  RuleToggleResult,
  RuntimeRule,
  RuleValidationResult,
  JsonObject,
} from "./types";
import { serializeProviderDrafts, serializeRulesText } from "./configDraft";

export type RuleApiTransport = <T>(path: string, options?: RequestInit) => Promise<T>;

export class RuleApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(message: string, status?: number, code?: string, payload?: unknown) {
    super(message);
    this.name = "RuleApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function messageOf(payload: unknown, fallback: string): string {
  const root = record(payload);
  const data = record(root?.data);
  return String(root?.message ?? root?.error ?? data?.message ?? data?.error ?? fallback);
}

function successOf(payload: unknown): boolean | undefined {
  const root = record(payload);
  return typeof root?.success === "boolean" ? root.success : undefined;
}

function dataOf(payload: unknown): unknown {
  const root = record(payload);
  return root?.data ?? payload;
}

function pathPart(value: string): string {
  return encodeURIComponent(value);
}

function withoutAbort(reason: unknown): Error | undefined {
  if (reason && typeof reason === "object" && "name" in reason && String((reason as { name?: unknown }).name) === "AbortError") return undefined;
  return reason instanceof Error ? reason : new Error(String(reason || "请求失败"));
}

export type RuleApi = ReturnType<typeof createRuleApi>;

export function createRuleApi(transport: RuleApiTransport = api): {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  loadRuntime(previous?: RuleStore, signal?: AbortSignal): Promise<RuleRuntimeLoadResult>;
  getConfig(signal?: AbortSignal): Promise<RuleConfigSnapshot>;
  toggleRule(rule: RuntimeRule, disabled: boolean, disconnectMatched: boolean, signal?: AbortSignal): Promise<RuleToggleResult>;
  selectProxy(groupName: string, proxyName: string, signal?: AbortSignal): Promise<unknown>;
  updateProvider(name: string, signal?: AbortSignal): Promise<unknown>;
  getProvider(name: string, signal?: AbortSignal): Promise<unknown>;
  validateConfig(draft: RuleConfigDraft, signal?: AbortSignal): Promise<RuleValidationResult>;
  saveConfig(draft: RuleConfigDraft, signal?: AbortSignal): Promise<unknown>;
} {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    try {
      const payload = await transport<T>(path, options);
      if (successOf(payload) === false) throw new RuleApiError(messageOf(payload, "规则接口返回失败"), undefined, String(record(payload)?.error ?? "request_failed"), payload);
      return payload;
    } catch (reason) {
      if (reason instanceof RuleApiError) throw reason;
      const status = reason && typeof reason === "object" && "status" in reason ? Number((reason as { status?: unknown }).status) : undefined;
      const code = reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code) : undefined;
      throw new RuleApiError(reason instanceof Error ? reason.message : "规则请求失败", Number.isFinite(status) ? status : undefined, code, reason);
    }
  }

  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    return request(path, signal ? { signal } : undefined);
  }

  async function loadRuntime(previous?: RuleStore, signal?: AbortSignal): Promise<RuleRuntimeLoadResult> {
    const paths = {
      rules: "/api/v1/mihomo/rules?limit=5000",
      providers: "/api/v1/mihomo/rule-providers",
      proxies: "/api/v1/mihomo/proxies",
      authority: "/api/v1/mihomo/config/mode",
    } as const;
    const entries = await Promise.allSettled(Object.entries(paths).map(async ([key, path]) => [key, await get(path, signal)] as const));
    const responses: { rules?: unknown; providers?: unknown; proxies?: unknown; authority?: unknown } = {};
    const errors: Error[] = [];
    for (const result of entries) {
      if (result.status === "fulfilled") responses[result.value[0] as keyof typeof responses] = result.value[1];
      else {
        const error = withoutAbort(result.reason);
        if (error) errors.push(error);
      }
    }
    const store = normalizeRuleSnapshot(responses.rules ?? {}, previous, Date.now(), responses);
    return { store, responses, errors };
  }

  async function getConfig(signal?: AbortSignal): Promise<RuleConfigSnapshot> {
    const [payload, authorityPayload] = await Promise.all([
      get("/api/v1/mihomo/rules-config", signal),
      get("/api/v1/mihomo/config/mode", signal).catch(() => undefined),
    ]);
    const payloadRoot = record(payload) ?? {};
    const data = record(dataOf(payload)) ?? {};
    const rawRules = Array.isArray(data.rules) ? data.rules : [];
    const ruleProviders = record(data["rule-providers"] ?? data.rule_providers) ?? {};
    const authority = record(data.mode) ?? record(data.config_authority) ?? record(data.configAuthority) ?? record(dataOf(authorityPayload)) ?? {};
    return {
      authority: {
        mode: String(authority.mode ?? "unknown") as RuleConfigSnapshot["authority"]["mode"],
        isDefault: Boolean(authority.is_default ?? authority.isDefault),
        activePath: String(authority.active_path ?? authority.activePath ?? ""),
        activeName: String(authority.active_name ?? authority.activeName ?? ""),
        runtimePath: String(authority.runtime_path ?? authority.runtimePath ?? "configs/mihomo/config.yaml"),
        canEditRules: Boolean(authority.can_edit_rules ?? authority.canEditRules),
        canEditRuleProviders: Boolean(authority.can_edit_rule_providers ?? authority.canEditRuleProviders),
      },
      rules: rawRules.map((item) => String(item)),
      ruleProviders: Object.fromEntries(Object.entries(ruleProviders).map(([name, value]) => [name, (record(value) ?? {}) as JsonObject])),
      yamlText: typeof data.yaml === "string" ? data.yaml : typeof data.raw_yaml === "string" ? data.raw_yaml : typeof payloadRoot.yaml === "string" ? payloadRoot.yaml : typeof payloadRoot.raw_yaml === "string" ? payloadRoot.raw_yaml : undefined,
      raw: payload,
    };
  }

  async function toggleRule(rule: RuntimeRule, disabled: boolean, disconnectMatched: boolean, signal?: AbortSignal): Promise<RuleToggleResult> {
    const payload = await request<unknown>(`/api/v1/mihomo/rules/${pathPart(rule.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled, disconnect_matched: disconnectMatched, uuid: rule.uuid, index: rule.index, type: rule.type, payload: rule.payload }),
      ...(signal ? { signal } : {}),
    });
    const data = record(dataOf(payload)) ?? {};
    const disconnect = record(data.disconnect);
    const failed = Array.isArray(disconnect?.failed_ids) ? disconnect.failed_ids : Array.isArray(disconnect?.failedIds) ? disconnect.failedIds : [];
    const result: RuleDisconnectResult | undefined = disconnect ? {
      matched: Number(disconnect.matched ?? 0) || 0,
      closed: Number(disconnect.closed ?? 0) || 0,
      failedIds: failed.filter((item): item is string => typeof item === "string"),
    } : undefined;
    return { disabled: typeof data.disabled === "boolean" ? data.disabled : disabled, disconnect: result };
  }

  async function selectProxy(groupName: string, proxyName: string, signal?: AbortSignal): Promise<unknown> {
    return request(`/api/v1/mihomo/proxies/${pathPart(groupName)}`, {
      method: "PUT",
      body: JSON.stringify({ name: proxyName }),
      ...(signal ? { signal } : {}),
    });
  }

  async function updateProvider(name: string, signal?: AbortSignal): Promise<unknown> {
    return request(`/api/v1/mihomo/rule-providers/${pathPart(name)}/update`, { method: "POST", ...(signal ? { signal } : {}) });
  }

  async function getProvider(name: string, signal?: AbortSignal): Promise<unknown> {
    return request(`/api/v1/mihomo/rule-providers/${pathPart(name)}`, signal ? { signal } : undefined);
  }

  async function validateConfig(draft: RuleConfigDraft, signal?: AbortSignal): Promise<RuleValidationResult> {
    const body = draft.mode === "yaml"
      ? { scope: "rules", yaml: draft.yamlText ?? draft.rulesText }
      : { scope: "rules", rules: serializeRulesText(draft.rulesText), "rule-providers": serializeProviderDrafts(draft.providers) };
    try {
      const payload = await request<unknown>("/api/v1/mihomo/proxy-config/validate", { method: "POST", body: JSON.stringify(body), ...(signal ? { signal } : {}) });
      const data = record(dataOf(payload)) ?? {};
      const rawIssues = Array.isArray(data.issues) ? data.issues : [];
      const issues = rawIssues.map((item) => {
        const row = record(item) ?? {};
        return { message: String(row.message ?? row.error ?? "校验失败"), path: row.path ? String(row.path) : undefined, line: row.line == null ? undefined : Number(row.line), severity: row.severity === "warning" ? "warning" as const : "error" as const };
      });
      return { valid: data.valid !== false && issues.every((item) => item.severity !== "error"), message: data.message ? String(data.message) : undefined, issues, raw: payload };
    } catch (reason) {
      return { valid: false, message: reason instanceof Error ? reason.message : "配置校验失败，未写入", issues: [{ message: reason instanceof Error ? reason.message : "配置校验失败，未写入", severity: "error" }], raw: reason };
    }
  }

  async function saveConfig(draft: RuleConfigDraft, signal?: AbortSignal): Promise<unknown> {
    if (draft.mode === "yaml") {
      return request("/api/v1/mihomo/rules-config", { method: "PUT", body: JSON.stringify({ yaml: draft.yamlText ?? draft.rulesText }), ...(signal ? { signal } : {}) });
    }
    return request("/api/v1/mihomo/rules-config", {
      method: "PUT",
      body: JSON.stringify({ rules: serializeRulesText(draft.rulesText), "rule-providers": serializeProviderDrafts(draft.providers) }),
      ...(signal ? { signal } : {}),
    });
  }

  return { request, loadRuntime, getConfig, toggleRule, selectProxy, updateProvider, getProvider, validateConfig, saveConfig };
}

export const ruleApi = createRuleApi();
