import { describe, expect, it } from "vitest";
import { normalizeRuleSnapshot, normalizeRules, normalizeRuleProviders } from "./normalize";
import { mergeRuleStore, patchRule } from "./ruleStore";
import { createEmptyRuleStore } from "./types";

describe("mihomo rule normalization", () => {
  it("keeps Controller order, display type and original index", () => {
    const rules = normalizeRules({ rules: [{ id: "a", index: 1, type: "RuleSet", payload: "ai", proxy: "AI" }, { id: "b", index: 2, type: "DomainSuffix", payload: "example.com", proxy: "DIRECT" }, { id: "c", index: 3, type: "MATCH", payload: "", proxy: "漏网之鱼" }] });
    expect(rules.map((rule) => rule.id)).toEqual(["a", "b", "c"]);
    expect(rules.map((rule) => rule.type)).toEqual(["RuleSet", "DomainSuffix", "MATCH"]);
    expect(rules.map((rule) => rule.index)).toEqual([1, 2, 3]);
  });

  it("accepts snake_case and camelCase statistics and disabled state", () => {
    const rules = normalizeRules({ items: [{ uuid: "one", index: 7, type: "RuleSet", payload: "x", disabled: true, hit_count: 4, missCount: 2, hit_at: "2026-01-01T00:00:00Z", lastMissAt: "2026-01-02T00:00:00Z", size: "128" }] });
    expect(rules[0]).toMatchObject({ id: "one", disabled: true, hitCount: 4, missCount: 2, lastHitAt: "2026-01-01T00:00:00Z", lastMissAt: "2026-01-02T00:00:00Z", size: 128 });
  });

  it("keeps unchanged rule references and patches only one row", () => {
    const previous = normalizeRuleSnapshot({ rules: [{ id: "a", index: 1, type: "MATCH", payload: "", proxy: "DIRECT" }] }, createEmptyRuleStore());
    const next = normalizeRuleSnapshot({ rules: [{ id: "a", index: 1, type: "MATCH", payload: "", proxy: "DIRECT" }] }, previous);
    expect(next.rules[0]).toBe(previous.rules[0]);
    const patched = patchRule(next, "a", { disabled: true });
    expect(patched.rules[0]).not.toBe(next.rules[0]);
    expect(patched.rules[0].disabled).toBe(true);
  });

  it("normalizes provider runtime fields without dropping config fields", () => {
    const providers = normalizeRuleProviders({ items: [{ name: "中文/ai", type: "http", behavior: "domain", url: "https://example.test", unknown: { keep: true }, runtime: { size: 2048, rule_count: 12, updated_at: "2026-01-01T00:00:00Z" } }] });
    expect(providers["中文/ai"]).toMatchObject({ size: 2048, ruleCount: 12, updatedAt: "2026-01-01T00:00:00Z", config: { unknown: { keep: true } } });
  });

  it("does not replace a useful snapshot with a transient empty response", () => {
    const previous = normalizeRuleSnapshot({ source: "controller", rules: [{ id: "a", index: 1, type: "MATCH", payload: "", proxy: "DIRECT" }] });
    const merged = mergeRuleStore(previous, normalizeRuleSnapshot({ source: "unknown" }, previous));
    expect(merged.rules).toBe(previous.rules);
  });

  it("keeps proxy-group members for in-place rule target selection", () => {
    const snapshot = normalizeRuleSnapshot(
      { rules: [{ id: "a", index: 1, type: "MATCH", proxy: "节点选择" }] },
      undefined,
      Date.now(),
      { proxies: { data: { groups: [{ name: "节点选择", type: "Selector", now: "香港节点", all: ["香港节点", "美国节点"] }], proxy_list: [{ name: "香港节点", type: "ss", delay: 88, alive: true }, { name: "美国节点", type: "ss", delay: 156, alive: true }] } } },
    );
    expect(snapshot.targets["节点选择"]).toMatchObject({
      selectedName: "香港节点",
      members: [
        { name: "香港节点", kind: "node", delay: 88, alive: true },
        { name: "美国节点", kind: "node", delay: 156, alive: true },
      ],
    });
  });
});
