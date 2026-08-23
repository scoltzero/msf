import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mosdns/rules/page.tsx", import.meta.url), "utf8");
const fallback = readFileSync(new URL("../../lib/mosdns-rules-data.ts", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("../../components/rules/RuleDialogs.tsx", import.meta.url), "utf8");
const pageStyles = readFileSync(new URL("../../app/mosdns/rules/mosdns-rules.css", import.meta.url), "utf8");

describe("MosDNS rule source freshness", () => {
  it("does not ship the old template timestamp as live UI data", () => {
    expect(fallback).not.toContain("2025/12/19");
  });

  it("surfaces partial and single-source update failures", () => {
    expect(page).toContain("payload?.success === false");
    expect(page).toContain("部分规则源更新失败");
    expect(page).toContain("failures.length > 0");
    expect(page).toContain('"error"');
    expect(dialogs).toContain('t.tone === "error"');
  });

  it("accepts routing text or SRS content without forcing the URL extension", () => {
    expect(dialogs).toContain('match(/\\.(srs|txt)$/i)');
    expect(dialogs).toContain("支持 SRS 二进制或文本规则");
    expect(dialogs).toContain("不限制 URL 扩展名");
  });

  it("keeps all MosDNS matcher modes available for DDNS rules", () => {
    expect(dialogs).toContain('useState(isDDNS ? "full" : "domain")');
    expect(dialogs).toContain("onAdd(isDirectIP ? value.trim() : rulePatternFor(mode, value))");
    for (const mode of ["domain", "full", "keyword", "regexp"]) {
      expect(dialogs).toContain(`value: "${mode}"`);
    }
    expect(page).toContain("categoryId={activeCat}");
  });

  it("preserves the special direct IP and redirect formats while editing", () => {
    expect(dialogs).toContain('const isDirectIP = normalizedCategory === "direct_ip"');
    expect(dialogs).toContain('const isRedirect = normalizedCategory === "redirect"');
    expect(dialogs).toContain("isRedirect ? target.trim() : undefined");
    expect(page).toContain('normalizedCategory === "direct_ip"');
    expect(page).toContain('normalizedCategory === "redirect"');
    expect(page).toContain('`${patternFor(mode, value)} ${String(target || "").trim()}`');
  });

  it("bounds rendering work for long personalized rule lists", () => {
    expect(page).toContain("<AppShell disablePageMotion>");
    expect(page).toContain("mosdns-rule-list");
    expect(page).toContain("mosdns-rule-row");
    expect(page).toContain("useWindowVirtualRows");
    expect(page).toContain("visibleRules.map");
    expect(page).not.toContain("rules.map((rule, index)");
    expect(page).toContain('data-virtualized="true"');
    expect(page).toContain("isDesktop && sortMode");
    expect(page).not.toContain("draggable");
    expect(pageStyles).toContain("content-visibility: auto");
    expect(pageStyles).toContain("backdrop-filter: none !important");
  });
});
