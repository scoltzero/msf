import { describe, expect, it } from "vitest";
import { resolveGroupTestPolicy, resolveProxyTestPolicy } from "./latency";
import { makeGlobalProxyKey, makeProviderProxyKey, normalizeProxySnapshot } from "./normalize";
import { planAllProxyTests, planProxyGroupTests, planProxyNodeTest, proxyTestRequestKey } from "./speedtestPlan";
import { buildProxyGroupRow, proxyGroupDraft } from "./groupConfig";
import { normalizeProxySettings } from "./settings";
import { proxyDelayForTestURL } from "./selectors";

describe("test URL inheritance and global overlay", () => {
  it("uses explicit group > global override > provider > fallback, retaining timeouts", () => {
    const base = { provider: { url: "https://provider.test", timeoutMs: 2345 }, pageFallback: "https://fallback.test", globalOverride: "https://global.test" };
    expect(resolveProxyTestPolicy(base)).toMatchObject({ url: "https://global.test", timeoutMs: 2345, source: "global-override" });
    expect(resolveProxyTestPolicy({ ...base, group: "https://group.test" }).url).toBe("https://group.test");
    expect(resolveProxyTestPolicy({ ...base, group: { url: "https://template.test", inherit: true } }).url).toBe("https://global.test");
    expect(resolveProxyTestPolicy({ ...base, globalOverride: "" }).url).toBe("https://provider.test");
    expect(resolveProxyTestPolicy({ pageFallback: "https://fallback.test" }).url).toBe("https://fallback.test");
    expect(resolveProxyTestPolicy({ ...base, scope: "provider-healthcheck", group: "https://group.test" }).url).toBe("https://global.test");
    expect(resolveProxyTestPolicy({ ...base, temporary: "https://one-run.test" }).url).toBe("https://one-run.test");
  });

  it("preserves legacy fallback settings without enabling global override", () => {
    expect(normalizeProxySettings({ version: 3, delayTestUrl: "https://legacy.test" })).toMatchObject({ delayTestUrl: "https://legacy.test", delayTestOverrideEnabled: false, delayTestOverrideUrl: "" });
    expect(normalizeProxySettings({ delayTestOverrideEnabled: true, delayTestOverrideUrl: "ftp://invalid.test" }).delayTestOverrideEnabled).toBe(false);
  });

  it("persists explicit group mode and retains the original URL on inheritance", () => {
    const draft = proxyGroupDraft({ name: "G", type: "url-test", url: "https://original.test", "x-msf-test-url-mode": "inherit" });
    expect(draft.testUrlMode).toBe("inherit");
    expect(buildProxyGroupRow(draft)).toMatchObject({ url: "https://original.test", "x-msf-test-url-mode": "inherit" });
    expect(buildProxyGroupRow({ ...draft, testUrlMode: "override", url: "https://group.test" })).toMatchObject({ url: "https://group.test", "x-msf-test-url-mode": "override" });
    expect(() => buildProxyGroupRow({ ...draft, testUrlMode: "override", url: "" })).toThrow();
    expect(() => buildProxyGroupRow({ ...draft, testUrlMode: "override", url: "ftp://invalid.test" })).toThrow();
  });

  it("uses each provider URL for mixed inherited groups and supports dashboard overlays", () => {
    const inherited = { name: "G", type: "Selector", all: ["one/A", "two/B"], test_policy: { url: "https://template.test", inherit: true } };
    const snapshot = {
      groups: [inherited], proxies: { G: inherited },
      providers: {
        one: { name: "one", test_policy: { url: "https://one.test", timeout_ms: 1200 }, proxies: [{ name: "A", type: "Trojan" }] },
        two: { name: "two", test_policy: { url: "https://two.test", timeout_ms: 2300 }, proxies: [{ name: "B", type: "Trojan" }] },
      },
      test_policy: { url: "https://fallback.test" },
    };
    const store = normalizeProxySnapshot(snapshot);
    expect(planProxyGroupTests(store, makeGlobalProxyKey("G")).targets.map((target) => target.policy.url)).toEqual(["https://one.test", "https://two.test"]);
    expect(store.providers.one.testPolicy?.timeoutMs).toBe(1200);
    expect(resolveGroupTestPolicy(undefined, Object.values(store.providers), "https://fallback.test").url).toBe("https://fallback.test");
    const overlaid = normalizeProxySnapshot({ ...snapshot, test_policy: { ...snapshot.test_policy, global_override_url: "https://global.test" } });
    expect(planProxyGroupTests(overlaid, makeGlobalProxyKey("G")).targets.map((target) => target.policy.url)).toEqual(["https://global.test", "https://global.test"]);
    expect(planProxyGroupTests(overlaid, makeGlobalProxyKey("G"), { globalOverride: "" }).targets.map((target) => target.policy.url)).toEqual(["https://one.test", "https://two.test"]);
    // A provider-only test has no group context.
    expect(planProxyNodeTest(overlaid, makeProviderProxyKey("one", "A")).targets[0].policy.url).toBe("https://global.test");
  });

  it("does not promote a backend fallback into an explicit group/provider policy", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["P/A"], test_policy: { url: "https://internal.test", source: "page-fallback" } }],
      providers: { P: { name: "P", proxies: [{ name: "A" }], test_policy: { url: "https://internal.test", source: "page-fallback" } } },
    });
    expect(planProxyGroupTests(store, makeGlobalProxyKey("G"), { pageFallback: "https://chosen.test" }).targets[0].policy.url).toBe("https://chosen.test");
  });

  it("keeps distinct URLs for a shared node instead of accepting the first group's URL", () => {
    const groups = ["one", "two"].map((name) => ({ name, type: "Selector", all: ["Node"], test_policy: { url: `https://${name}.test` } }));
    const store = normalizeProxySnapshot({ groups, proxies: { Node: { name: "Node", type: "Trojan" } } });
    const plan = planAllProxyTests(store, { globalOverride: "https://global.test" });
    expect(plan.targets.map((target) => target.policy.url)).toEqual(["https://one.test", "https://two.test", "https://global.test"]);
    expect(new Set(plan.targets.map((target) => target.physicalKey)).size).toBe(1);
    expect(new Set(plan.targets.map(proxyTestRequestKey)).size).toBe(3);
  });

  it("shows the matching URL's sample and marks unrelated old measurements stale", () => {
    const store = normalizeProxySnapshot({ proxies: { Node: { name: "Node", type: "Trojan", history: [{ delay: 50, url: "https://one.test" }, { delay: 200, url: "https://two.test" }] } } });
    const node = store.entities[makeGlobalProxyKey("Node")];
    expect(proxyDelayForTestURL(node, "https://one.test")).toMatchObject({ delay: 50, stale: false });
    expect(proxyDelayForTestURL(node, "https://two.test")).toMatchObject({ delay: 200, stale: false });
    expect(proxyDelayForTestURL(node, "https://new.test")).toMatchObject({ delay: undefined, stale: true });
  });
});
