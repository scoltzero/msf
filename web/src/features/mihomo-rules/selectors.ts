import { compileRuleSearch, searchableRuleText, type RuleSearchMatcher } from "./search";
import type { RuleTargetState, RuleStore, RuntimeRule, RuntimeRuleProvider } from "./types";

export type RuleChain = {
  chain: string[];
  selectedName?: string;
  finalNode?: string;
  delay?: number;
  cycleDetected: boolean;
  missingReference?: string;
};

export function selectRules(store: RuleStore): RuntimeRule[] {
  return store.rules;
}
export function selectProviders(store: RuleStore): RuntimeRuleProvider[] {
  return store.providerNames.map((name) => store.providers[name]).filter((item): item is RuntimeRuleProvider => Boolean(item));
}

export function selectRuleById(store: RuleStore, id: string): RuntimeRule | undefined {
  return store.rules.find((rule) => rule.id === id);
}

export function selectProvider(store: RuleStore, name: string): RuntimeRuleProvider | undefined {
  return store.providers[name];
}

export function selectFilteredRules(
  store: RuleStore,
  query: string,
  mode: "plain" | "regex" = "plain",
): { rules: RuntimeRule[]; matcher: RuleSearchMatcher; error?: string } {
  const matcher = compileRuleSearch(query, mode);
  if (!matcher.valid) return { rules: [], matcher, error: matcher.error };
  const rules = !matcher.query
    ? store.rules
    : store.rules.filter((rule) => matcher.test(searchableRuleText(rule, store.targets[rule.target])));
  return { rules, matcher };
}

export function selectRuleTarget(rule: RuntimeRule, store: RuleStore): RuleChain | undefined {
  if (!rule.target || rule.target === "-") return undefined;
  const target = store.targets[rule.target];
  if (!target) return { chain: [rule.target], cycleDetected: false, missingReference: rule.target };
  return {
    chain: target.chain,
    selectedName: target.selectedName,
    finalNode: target.finalNode,
    delay: target.delay,
    cycleDetected: target.cycleDetected,
    missingReference: target.missingReference,
  };
}

/** Resolve a chain from a simple target map.  This is exported independently
 * so pure tests and future proxy-store adapters do not need React. */
export function resolveRuleTargetChain(
  name: string,
  targets: Record<string, RuleTargetState>,
  maxDepth = 32,
): RuleChain {
  const start = targets[name];
  if (!start) return { chain: [name], cycleDetected: false, missingReference: name };
  const chain: string[] = [name];
  const visited = new Set<string>([name]);
  let current = start.selectedName;
  let cycleDetected = false;
  let missingReference: string | undefined;
  while (current && chain.length < maxDepth) {
    if (visited.has(current)) {
      cycleDetected = true;
      break;
    }
    visited.add(current);
    chain.push(current);
    const next = targets[current];
    if (!next) {
      missingReference = current;
      break;
    }
    current = next.selectedName;
  }
  return {
    chain: start.chain.length > 1 || cycleDetected || missingReference ? chain : start.chain,
    selectedName: start.selectedName,
    finalNode: cycleDetected || missingReference ? undefined : chain.at(-1),
    delay: start.delay,
    cycleDetected: cycleDetected || start.cycleDetected,
    missingReference: missingReference ?? start.missingReference,
  };
}

export function ruleStableKey(rule: RuntimeRule): string {
  if (rule.id.trim()) return rule.id;
  return `${rule.index}:${rule.type}:${rule.payload}:${rule.target}`;
}

export function selectRuleStats(store: RuleStore): { hitCount: number; missCount: number; observed: number } {
  let hitCount = 0;
  let missCount = 0;
  let observed = 0;
  for (const rule of store.rules) {
    if (rule.hitCount !== undefined) {
      hitCount += rule.hitCount;
      observed += 1;
    }
    if (rule.missCount !== undefined) missCount += rule.missCount;
  }
  return { hitCount, missCount, observed };
}

export function providerRuleCount(provider: RuntimeRuleProvider): number {
  return provider.ruleCount ?? 0;
}
