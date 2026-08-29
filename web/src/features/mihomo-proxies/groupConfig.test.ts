import { describe, expect, it } from "vitest";
import { buildProxyGroupRow, proxyGroupDraft, proxyGroupRows, replaceProxyGroup } from "./groupConfig";

const smartDefaults = {
  policyPriority: "",
  uselightgbm: false,
  collectdata: false,
  sampleRate: 0,
  preferAsn: false,
};

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
      ...smartDefaults,
    });
    expect(row).toEqual({ filter: "US", hidden: true, name: "US", type: "select", proxies: ["DIRECT"] });
  });

  it("keeps unknown config fields and only emits fields supported by the selected type", () => {
    const row = buildProxyGroupRow({
      name: "Balanced", type: "load-balance", icon: "icon.svg", proxies: "A\nB", url: "https://example.test",
      interval: 300, lazy: true, tolerance: 50, strategy: "round-robin",
      advanced: JSON.stringify({ "include-all-providers": true, filter: "HK" }),
      ...smartDefaults,
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

describe("smart proxy group structured editing", () => {
  it("defaults uselightgbm and collectdata to false in the draft", () => {
    const draft = proxyGroupDraft({ name: "Smart", type: "smart" });
    expect(draft.uselightgbm).toBe(false);
    expect(draft.collectdata).toBe(false);
    expect(draft.preferAsn).toBe(false);
    expect(draft.policyPriority).toBe("");
    expect(draft.sampleRate).toBe(0);
  });

  it("round-trips every supported smart field with exact YAML keys", () => {
    const row = buildProxyGroupRow({
      name: "Smart", type: "smart", icon: "smart.svg", proxies: "A\nB",
      url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing",
      policyPriority: "url-test", uselightgbm: true, collectdata: true, sampleRate: 0.3, preferAsn: true,
      advanced: JSON.stringify({ "policy-priority": "url-test", uselightgbm: true, collectdata: true, "sample-rate": 0.3, "prefer-asn": true }),
    });
    expect(row).toMatchObject({
      name: "Smart", type: "smart", icon: "smart.svg", proxies: ["A", "B"],
      "policy-priority": "url-test", uselightgbm: true, collectdata: true, "sample-rate": 0.3, "prefer-asn": true,
    });
    expect(row).not.toHaveProperty("tolerance");
    expect(row).not.toHaveProperty("interval");
    expect(row).not.toHaveProperty("url");
    expect(row).not.toHaveProperty("lazy");
    expect(row).not.toHaveProperty("strategy");
  });

  it("does not erase unrelated advanced fields", () => {
    const row = buildProxyGroupRow({
      name: "Smart", type: "smart", icon: "", proxies: "",
      url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing",
      ...smartDefaults,
      advanced: JSON.stringify({ "include-all-providers": true, filter: "HK", tfo: true }),
    });
    expect(row).toMatchObject({ name: "Smart", type: "smart", "include-all-providers": true, filter: "HK", tfo: true });
  });

  it("preserves top-level url/timeout/max-failed-times and surrounding unknown fields", () => {
    const row = buildProxyGroupRow({
      name: "Smart", type: "smart", icon: "", proxies: "",
      url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing",
      policyPriority: "", uselightgbm: false, collectdata: false, sampleRate: 0, preferAsn: false,
      advanced: JSON.stringify({ url: "https://example.test", timeout: 5000, "max-failed-times": 3, "include-all-providers": true, "policy-priority": "fallback", collectdata: true }),
    });
    // Unknown/unsupported top-level fields must survive a smart edit untouched.
    expect(row).toMatchObject({ url: "https://example.test", timeout: 5000, "max-failed-times": 3, "include-all-providers": true });
    // Smart fields that the editor owns are re-emitted from the draft, not stale advanced.
    expect(row["policy-priority"]).toBeUndefined();
    expect(row.collectdata).toBe(false);
    expect(row).not.toHaveProperty("tolerance");
    expect(row).not.toHaveProperty("interval");
  });

  it("omits sample-rate unless it is a valid 0..1 value", () => {
    const row = buildProxyGroupRow({
      name: "Smart", type: "smart", icon: "", proxies: "",
      url: "", interval: 300, lazy: false, tolerance: 50, strategy: "consistent-hashing",
      ...smartDefaults,
      advanced: "{}",
    });
    expect(row).not.toHaveProperty("sample-rate");
  });
});
