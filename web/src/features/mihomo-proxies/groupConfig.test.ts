import { describe, expect, it } from "vitest";
import { buildProxyGroupRow, proxyGroupDraft, proxyGroupRows, replaceProxyGroup } from "./groupConfig";

describe("proxy group structured editing", () => {
  it("never turns controller-expanded members into configured proxies", () => {
    const draft = proxyGroupDraft({ name: "US", type: "url-test", all: ["Provider Node"], now: "Provider Node", filter: "US" });
    expect(draft.proxies).toBe("");
    expect(JSON.parse(draft.advanced)).not.toHaveProperty("proxies");
  });

  it("removes health-check-only fields when changing to select", () => {
    const row = buildProxyGroupRow({
      name: "US", type: "select", icon: "", proxies: "DIRECT", url: "https://example.test",
      interval: 30, lazy: true, tolerance: 50, strategy: "round-robin",
      advanced: JSON.stringify({ filter: "US", hidden: true, url: "https://old.test", interval: 60, lazy: true, tolerance: 100 }),
    });
    expect(row).toEqual({ filter: "US", hidden: true, name: "US", type: "select", proxies: ["DIRECT"] });
  });

  it("keeps unknown config fields and only emits fields supported by the selected type", () => {
    const row = buildProxyGroupRow({
      name: "Balanced", type: "load-balance", icon: "icon.svg", proxies: "A\nB", url: "https://example.test",
      interval: 300, lazy: true, tolerance: 50, strategy: "round-robin",
      advanced: JSON.stringify({ "include-all-providers": true, filter: "HK" }),
    });
    expect(row).toMatchObject({
      name: "Balanced", type: "load-balance", icon: "icon.svg", proxies: ["A", "B"],
      url: "https://example.test", interval: 300, lazy: true, strategy: "round-robin",
      "include-all-providers": true, filter: "HK",
    });
    expect(row).not.toHaveProperty("tolerance");
  });

  it("extracts wrapped rows and replaces the requested group", () => {
    const rows = proxyGroupRows({ success: true, data: { "proxy-groups": [{ name: "A" }, { name: "B" }] } });
    expect(replaceProxyGroup(rows, "B", { name: "C" })).toEqual([{ name: "A" }, { name: "C" }]);
  });
});
