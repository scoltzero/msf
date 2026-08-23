import { describe, expect, it } from "vitest";
import { createRuleApi } from "./ruleApi";
import { createRuleConfigDraft } from "./configDraft";

describe("rule API configuration payloads", () => {
  it("sends YAML at the top level for validation", async () => {
    let captured: RequestInit | undefined;
    const client = createRuleApi(async <T>(_path: string, options?: RequestInit) => {
      captured = options;
      return { success: true, data: { valid: true, issues: [] } } as T;
    });
    const draft = createRuleConfigDraft({ rules: ["MATCH,DIRECT"], providers: {}, mode: "yaml", yamlText: "rules:\n  - MATCH,DIRECT\n" });
    const result = await client.validateConfig(draft);
    expect(result.valid).toBe(true);
    const body = JSON.parse(String(captured?.body));
    expect(body.scope).toBe("rules");
    expect(body.yaml).toContain("rules:");
    expect(body.draft).toBeUndefined();
  });

  it("selects a proxy inside the rule page without navigation", async () => {
    let capturedPath = "";
    let captured: RequestInit | undefined;
    const client = createRuleApi(async <T>(path: string, options?: RequestInit) => {
      capturedPath = path;
      captured = options;
      return { success: true, data: { updated: true } } as T;
    });
    await client.selectProxy("节点选择/AI", "🇺🇸 United States 02");
    expect(capturedPath).toBe(`/api/v1/mihomo/proxies/${encodeURIComponent("节点选择/AI")}`);
    expect(captured?.method).toBe("PUT");
    expect(JSON.parse(String(captured?.body))).toEqual({ name: "🇺🇸 United States 02" });
  });
});
