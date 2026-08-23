import { describe, expect, it } from "vitest";
import { createRuleConfigDraft, deepMergeJsonObject, serializeRuleConfigYaml, serializeRulesText } from "./configDraft";
import { checkYamlSafety } from "./yamlSafety";
import { DEFAULT_RULE_SETTINGS, normalizeRuleSettings } from "./settings";

describe("rule configuration safety", () => {
  it("only removes true blank lines and preserves non-empty line content", () => {
    expect(serializeRulesText("  DOMAIN-SUFFIX,example.com,节点选择  \n\nMATCH,漏网之鱼\n  ")).toEqual(["  DOMAIN-SUFFIX,example.com,节点选择  ", "MATCH,漏网之鱼"]);
  });

  it("deep merges structured provider edits and keeps unknown fields", () => {
    const merged = deepMergeJsonObject({ type: "http", interval: 3600, "health-check": { enable: true, url: "https://a" }, future: { keep: true } }, { "health-check": { interval: 300 }, url: "https://b" });
    expect(merged).toEqual({ type: "http", interval: 3600, "health-check": { enable: true, url: "https://a", interval: 300 }, future: { keep: true }, url: "https://b" });
  });

  it("detects anchors, aliases and merge keys", () => {
    const result = checkYamlSafety("rules: &base\n  - MATCH,DIRECT\nrule-providers:\n  <<: *base\n");
    expect(result.safe).toBe(false);
    expect(result.features).toEqual(expect.arrayContaining(["anchor", "alias", "merge-key"]));
  });

  it("migrates settings and keeps disconnect disabled by default", () => {
    expect(DEFAULT_RULE_SETTINGS.disconnectMatchedOnDisable).toBe(false);
    expect(normalizeRuleSettings({ search_mode: "regex", disconnect_matched_on_disable: true }).searchMode).toBe("regex");
  });

  it("generates legal partial YAML with indented provider fields", () => {
    const yaml = serializeRuleConfigYaml("DOMAIN-SUFFIX,example.com,节点选择\nMATCH,漏网之鱼", { "中文/ai": { type: "http", behavior: "domain", url: "https://example.test", future: { enabled: true } } });
    expect(yaml).toContain('  "中文/ai":');
    expect(yaml).toContain('    type: "http"');
    expect(yaml).toContain('      enabled: true');
    expect(yaml).toContain('  - "DOMAIN-SUFFIX,example.com,节点选择"');
    expect(createRuleConfigDraft({ rules: ["MATCH,DIRECT"], providers: {} }).yamlText).toContain("rule-providers:\n  {}");
  });
});
