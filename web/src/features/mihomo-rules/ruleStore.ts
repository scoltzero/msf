import { createEmptyRuleStore, type RuleStore, type RuleStoreAction } from "./types";

export const EMPTY_RULE_STORE = createEmptyRuleStore();

export function patchRule(store: RuleStore, id: string, patch: Partial<Pick<import("./types").RuntimeRule, "disabled" | "hitCount" | "missCount" | "lastHitAt" | "lastMissAt">>): RuleStore {
  const index = store.rules.findIndex((rule) => rule.id === id);
  if (index < 0) return store;
  const current = store.rules[index];
  const nextRule = { ...current, ...patch };
  if (Object.keys(patch).every((key) => current[key as keyof typeof current] === nextRule[key as keyof typeof nextRule])) return store;
  const rules = [...store.rules];
  rules[index] = nextRule;
  return { ...store, rules };
}

export function patchProvider(store: RuleStore, name: string, patch: Partial<import("./types").RuntimeRuleProvider>): RuleStore {
  const current = store.providers[name];
  if (!current) return store;
  const next = { ...current, ...patch };
  const providers = { ...store.providers, [name]: next };
  return { ...store, providers };
}

export function mergeRuleStore(previous: RuleStore, next: RuleStore): RuleStore {
  const providers = Object.keys(next.providers).length ? next.providers : previous.providers;
  const providerNames = next.providerNames.length ? next.providerNames : previous.providerNames;
  const rules = next.rules.length || next.controllerAvailable || !previous.rules.length ? next.rules : previous.rules;
  const targets = Object.keys(next.targets).length ? next.targets : previous.targets;
  return {
    ...next,
    rules,
    providers,
    providerNames,
    targets,
    capabilities: next.capabilities ?? previous.capabilities,
    authority: next.authority.mode === "unknown" ? previous.authority : next.authority,
    fetchedAt: next.fetchedAt || previous.fetchedAt,
    source: next.source === "unknown" ? previous.source : next.source,
    controllerAvailable: next.controllerAvailable || previous.controllerAvailable,
  };
}

export function ruleStoreReducer(store: RuleStore, action: RuleStoreAction): RuleStore {
  switch (action.type) {
    case "replace":
      return action.store;
    case "merge":
      return mergeRuleStore(store, action.store);
    case "patch-rule":
      return patchRule(store, action.id, action.patch);
    case "patch-provider":
      return patchProvider(store, action.name, action.patch);
    case "provider-updating":
      return patchProvider(store, action.name, { updating: action.updating });
    case "clear":
      return createEmptyRuleStore();
    default:
      return store;
  }
}
