import { describe, expect, it } from "vitest";
import { compileRuleSearch, highlightText, isSafeRuleRegex } from "./search";
import { filterRules } from "./search";
import type { RuntimeRule } from "./types";

const rule = (index: number, payload: string): RuntimeRule => ({ id: String(index), index, type: "DomainSuffix", normalizedType: "domainsuffix", payload, target: "DIRECT", disabled: false, raw: payload });

describe("rule search", () => {
  it("performs case-insensitive plain matching and highlighting", () => {
    const matcher = compileRuleSearch("Example", "plain");
    expect(matcher.test("example.com")).toBe(true);
    expect(highlightText("example.com", matcher)).toEqual([{ text: "example", matched: true }, { text: ".com", matched: false }]);
  });

  it("rejects invalid and high-risk regex without falling back to a previous expression", () => {
    expect(compileRuleSearch("(", "regex").valid).toBe(false);
    expect(isSafeRuleRegex("(a+)+")).toBe(false);
    expect(compileRuleSearch("a".repeat(129), "regex").error).toContain("128");
  });

  it("filters without reordering or renumbering", () => {
    const result = filterRules([rule(4, "four"), rule(8, "eight"), rule(12, "twelve")], "eight");
    expect(result.rules.map((item) => item.index)).toEqual([8]);
  });
});
