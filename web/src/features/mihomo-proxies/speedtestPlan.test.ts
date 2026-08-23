import { describe, expect, it } from "vitest";
import { makeGlobalProxyKey, makeProviderProxyKey, normalizeProxySnapshot } from "./normalize";
import { planAllProxyTests, planProxyGroupTests, planProxyNodeTest } from "./speedtestPlan";

describe("Mihomo speed-test planning", () => {
  it("counts 45 group leaves plus one provider-only leaf as 46 physical nodes", () => {
    const names = Array.from({ length: 45 }, (_, index) => `Node-${index + 1}`);
    const group = { name: "G", type: "Selector", all: [...names, "DIRECT", "REJECT", "COMPATIBLE", "PASS", "PASS-RULE"] };
    const proxies = Object.fromEntries([
      ["G", group],
      ...names.map((name) => [name, { name, type: "Trojan" }]),
      ["DIRECT", { name: "DIRECT", type: "Direct" }],
      ["REJECT", { name: "REJECT", type: "Reject" }],
      ["COMPATIBLE", { name: "COMPATIBLE", type: "Compatible" }],
      ["PASS", { name: "PASS", type: "Pass" }],
      ["PASS-RULE", { name: "PASS-RULE", type: "PassRule" }],
    ]);
    const store = normalizeProxySnapshot({
      groups: [group],
      proxies,
      providers: { airport: { name: "airport", proxies: [{ name: "Provider-only", type: "Trojan" }] } },
    });

    const groupPlan = planProxyGroupTests(store, makeGlobalProxyKey("G"));
    const allPlan = planAllProxyTests(store);
    expect(groupPlan.targets).toHaveLength(45);
    expect(allPlan.targets).toHaveLength(46);
    expect(groupPlan.skippedTargets).toHaveLength(5);
    expect(groupPlan.skippedTargets.every((target) => target.reason === "builtin")).toBe(true);
    expect(allPlan.targets.some((target) => target.key === makeGlobalProxyKey("DIRECT"))).toBe(false);
    expect(allPlan.targets.some((target) => target.key === makeGlobalProxyKey("REJECT"))).toBe(false);
    expect(allPlan.targets.some((target) => target.key === makeGlobalProxyKey("COMPATIBLE"))).toBe(false);
    expect(allPlan.targets.some((target) => target.key === makeGlobalProxyKey("PASS"))).toBe(false);
    expect(allPlan.targets.some((target) => target.key === makeGlobalProxyKey("PASS-RULE"))).toBe(false);
  });

  it("resolves only the current exit of nested direct members and deduplicates by physical key", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "Outer", type: "Selector", all: ["Inner", "Leaf-1", "Inner", "Leaf-1"], now: "Inner" },
        { name: "Inner", type: "Selector", all: ["Leaf-1", "Leaf-2", "Leaf-2"], now: "Leaf-2" },
      ],
      proxies: {
        Outer: { name: "Outer", type: "Selector", all: ["Inner", "Leaf-1", "Inner", "Leaf-1"], now: "Inner" },
        Inner: { name: "Inner", type: "Selector", all: ["Leaf-1", "Leaf-2", "Leaf-2"], now: "Leaf-2" },
        "Leaf-1": { name: "Leaf-1", type: "Trojan" },
        "Leaf-2": { name: "Leaf-2", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("Outer"));
    expect(plan.targets.map((target) => target.key)).toEqual([makeGlobalProxyKey("Leaf-2"), makeGlobalProxyKey("Leaf-1")]);
    expect(plan.targets[0].physicalKey).toBe(makeGlobalProxyKey("Leaf-2"));
    expect(plan.targets[0].displayKeys).toEqual([
      makeGlobalProxyKey("Inner"),
      makeGlobalProxyKey("Leaf-2"),
    ]);
    expect(plan.cycles).toHaveLength(0);
  });

  it("detects group cycles while retaining reachable physical leaves", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "A", type: "Selector", all: ["B", "Leaf"], now: "B" },
        { name: "B", type: "Selector", all: ["A", "Leaf"], now: "A" },
      ],
      proxies: {
        A: { name: "A", type: "Selector", all: ["B", "Leaf"], now: "B" },
        B: { name: "B", type: "Selector", all: ["A", "Leaf"], now: "A" },
        Leaf: { name: "Leaf", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("A"));
    expect(plan.targets.map((target) => target.key)).toEqual([makeGlobalProxyKey("Leaf")]);
    expect(plan.skippedTargets.some((target) => target.reason === "cycle")).toBe(true);
    expect(plan.cycles).toEqual([[makeGlobalProxyKey("B"), makeGlobalProxyKey("A"), makeGlobalProxyKey("B")]]);
  });

  it("keeps same-name nodes from different providers as separate composite keys", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["p1/Same", "p2/Same", "p1/Same"] }],
      proxies: { G: { name: "G", type: "Selector", all: ["p1/Same", "p2/Same", "p1/Same"] } },
      providers: {
        p1: { name: "p1", proxies: [{ name: "Same", type: "Trojan" }] },
        p2: { name: "p2", proxies: [{ name: "Same", type: "Trojan" }] },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("G"));
    expect(plan.targets.map((target) => target.key)).toEqual([
      makeProviderProxyKey("p1", "Same"),
      makeProviderProxyKey("p2", "Same"),
    ]);
    expect(plan.targets[0].node.name).toBe(plan.targets[1].node.name);
    expect(new Set(plan.targets.map((target) => target.key)).size).toBe(2);
  });

  it("tests a nested group card through its selected physical exit only", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "Nested", type: "Selector", all: ["Exit", "Other"], now: "Exit" }],
      proxies: {
        Nested: { name: "Nested", type: "Selector", all: ["Exit", "Other"], now: "Exit" },
        Exit: { name: "Exit", type: "Trojan" },
        Other: { name: "Other", type: "Trojan" },
      },
    });
    const plan = planProxyNodeTest(store, makeGlobalProxyKey("Nested"));
    expect(plan.targets.map((target) => target.key)).toEqual([makeGlobalProxyKey("Exit")]);
    expect(plan.targets[0].displayKeys).toEqual([makeGlobalProxyKey("Nested"), makeGlobalProxyKey("Exit")]);
  });

  it("does not count unresolved current exits as failures", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "NoSelection", type: "Selector", all: ["Leaf"] }],
      proxies: {
        NoSelection: { name: "NoSelection", type: "Selector", all: ["Leaf"] },
        Leaf: { name: "Leaf", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("NoSelection"));
    expect(plan.targets).toHaveLength(1);
    expect(plan.skippedTargets).toHaveLength(0);

    const nested = normalizeProxySnapshot({
      groups: [{ name: "Outer", type: "Selector", all: ["NoSelection"] }, { name: "NoSelection", type: "Selector", all: ["Leaf"] }],
      proxies: {
        Outer: { name: "Outer", type: "Selector", all: ["NoSelection"], now: "NoSelection" },
        NoSelection: { name: "NoSelection", type: "Selector", all: ["Leaf"] },
        Leaf: { name: "Leaf", type: "Trojan" },
      },
    });
    const nestedPlan = planProxyGroupTests(nested, makeGlobalProxyKey("Outer"));
    expect(nestedPlan.targets).toHaveLength(0);
    expect(nestedPlan.skippedTargets[0].reason).toBe("no-final-exit");
  });

  it("attributes the nearest group policy before provider and fallback policies", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["Node"], test_policy: { url: "https://group.test", timeoutMs: 1_200 } }],
      proxies: { G: { name: "G", type: "Selector", all: ["Node"], test_policy: { url: "https://group.test", timeoutMs: 1_200 } }, Node: { name: "Node", type: "Trojan" } },
      providers: { airport: { name: "airport", test_policy: { url: "https://provider.test", timeoutMs: 2_300 }, proxies: [{ name: "Node" }] } },
      test_policy: { url: "https://advanced.test", timeoutMs: 3_400 },
    });
    const groupPlan = planProxyGroupTests(store, makeGlobalProxyKey("G"));
    expect(groupPlan.targets[0].policy).toMatchObject({ url: "https://group.test", timeoutMs: 1_200 });

    const providerPlan = planProxyNodeTest(store, makeProviderProxyKey("airport", "Node"));
    expect(providerPlan.targets[0].policy).toMatchObject({ url: "https://provider.test", timeoutMs: 2_300 });
  });

  it("does not scan non-selected descendants of a nested direct member", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "Outer", type: "Selector", all: ["Inner"], now: "Inner" },
        { name: "Inner", type: "Selector", all: ["Leaf-A", "Leaf-B", "Leaf-C"], now: "Leaf-B" },
      ],
      proxies: {
        Outer: { name: "Outer", type: "Selector", all: ["Inner"], now: "Inner" },
        Inner: { name: "Inner", type: "Selector", all: ["Leaf-A", "Leaf-B", "Leaf-C"], now: "Leaf-B" },
        "Leaf-A": { name: "Leaf-A", type: "Trojan" },
        "Leaf-B": { name: "Leaf-B", type: "Trojan" },
        "Leaf-C": { name: "Leaf-C", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("Outer"));

    expect(plan.targets.map((target) => target.key)).toEqual([makeGlobalProxyKey("Leaf-B")]);
    expect(plan.targets[0].path).toEqual([
      makeGlobalProxyKey("Outer"),
      makeGlobalProxyKey("Inner"),
      makeGlobalProxyKey("Leaf-B"),
    ]);
    expect(plan.targets[0].displayKeys).toEqual([makeGlobalProxyKey("Inner"), makeGlobalProxyKey("Leaf-B")]);
  });

  it("merges attribution keys when direct members resolve to one physical exit", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "Outer", type: "Selector", all: ["A", "B", "A"] },
        { name: "A", type: "Selector", all: ["Leaf"], now: "Leaf" },
        { name: "B", type: "Selector", all: ["Leaf"], now: "Leaf" },
      ],
      proxies: {
        Outer: { name: "Outer", type: "Selector", all: ["A", "B", "A"] },
        A: { name: "A", type: "Selector", all: ["Leaf"], now: "Leaf" },
        B: { name: "B", type: "Selector", all: ["Leaf"], now: "Leaf" },
        Leaf: { name: "Leaf", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("Outer"));

    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].physicalKey).toBe(makeGlobalProxyKey("Leaf"));
    expect(new Set(plan.targets[0].displayKeys)).toEqual(new Set([
      makeGlobalProxyKey("A"),
      makeGlobalProxyKey("B"),
      makeGlobalProxyKey("Leaf"),
    ]));
  });

  it("keeps executable totals separate from built-in, cycle, and no-exit skips", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "Outer", type: "Selector", all: ["Leaf", "Nested", "DIRECT", "REJECT", "Broken", "Cycle" ] },
        { name: "Nested", type: "Selector", all: ["NestedLeaf"], now: "NestedLeaf" },
        { name: "Broken", type: "Selector", all: ["BrokenLeaf"] },
        { name: "Cycle", type: "Selector", all: ["CyclePeer"], now: "CyclePeer" },
        { name: "CyclePeer", type: "Selector", all: ["Cycle"], now: "Cycle" },
      ],
      proxies: {
        Outer: { name: "Outer", type: "Selector", all: ["Leaf", "Nested", "DIRECT", "REJECT", "Broken", "Cycle"] },
        Nested: { name: "Nested", type: "Selector", all: ["NestedLeaf"], now: "NestedLeaf" },
        Broken: { name: "Broken", type: "Selector", all: ["BrokenLeaf"] },
        Cycle: { name: "Cycle", type: "Selector", all: ["CyclePeer"], now: "CyclePeer" },
        CyclePeer: { name: "CyclePeer", type: "Selector", all: ["Cycle"], now: "Cycle" },
        Leaf: { name: "Leaf", type: "Trojan" },
        NestedLeaf: { name: "NestedLeaf", type: "Trojan" },
        DIRECT: { name: "DIRECT", type: "Direct" },
        REJECT: { name: "REJECT", type: "Reject" },
        BrokenLeaf: { name: "BrokenLeaf", type: "Trojan" },
      },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("Outer"));
    const reasons = plan.skippedTargets.map((target) => target.reason);

    expect(plan.targets.map((target) => target.key)).toEqual([
      makeGlobalProxyKey("Leaf"),
      makeGlobalProxyKey("NestedLeaf"),
    ]);
    expect(plan.targets).toHaveLength(2);
    expect(reasons.filter((reason) => reason === "builtin")).toHaveLength(2);
    expect(reasons).toContain("cycle");
    expect(reasons).toContain("no-final-exit");
    expect(plan.targets.length + plan.skippedTargets.length).toBe(6);
  });

  it("includes provider and custom physical sources once in an all plan", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["airport/Shared", "Custom"] }],
      proxies: {
        G: { name: "G", type: "Selector", all: ["airport/Shared", "Custom"] },
        Custom: { name: "Custom", type: "Trojan" },
      },
      providers: {
        airport: {
          name: "airport",
          proxies: [
            { name: "Shared", type: "Trojan" },
            { name: "Provider-only", type: "Trojan" },
          ],
        },
      },
    });
    const plan = planAllProxyTests(store);
    const keys = plan.targets.map((target) => target.physicalKey);

    expect(keys).toContain(makeProviderProxyKey("airport", "Shared"));
    expect(keys).toContain(makeProviderProxyKey("airport", "Provider-only"));
    expect(keys).toContain(makeGlobalProxyKey("Custom"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => key === makeProviderProxyKey("airport", "Shared"))).toHaveLength(1);
  });

  it("coalesces proxy-map and proxy-list copies by their embedded provider name", () => {
    const airportNodes = [
      { name: "Airport-A", type: "Trojan", provider_name: "airport" },
      { name: "Airport-B", type: "Trojan", provider_name: "airport" },
    ];
    const manualNode = { name: "Manual", type: "VLESS", provider_name: "msf_manual" };
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["Airport-A", "Manual"] }],
      proxies: {
        G: { name: "G", type: "Selector", all: ["Airport-A", "Manual"] },
        "Airport-A": airportNodes[0],
        "Airport-B": airportNodes[1],
        Manual: manualNode,
      },
      // VM119 returns the same physical nodes in both the proxy map and this
      // flattened list. These rows must reuse the provider-scoped keys above.
      proxy_list: [...airportNodes, manualNode],
      providers: [
        { id: "airport", name: "airport", proxies: airportNodes },
        { id: "msf_manual", name: "msf_manual", proxies: [manualNode] },
      ],
    });
    const plan = planAllProxyTests(store);
    const keys = plan.targets.map((target) => target.physicalKey);

    expect(keys).toHaveLength(3);
    expect(keys).toEqual(expect.arrayContaining([
      makeProviderProxyKey("airport", "Airport-A"),
      makeProviderProxyKey("airport", "Airport-B"),
      makeProviderProxyKey("msf_manual", "Manual"),
    ]));
    expect(keys.some((key) => key === makeGlobalProxyKey("Airport-A"))).toBe(false);
    expect(keys.some((key) => key === makeGlobalProxyKey("Manual"))).toBe(false);
  });

  it("uses page fallback URL and timeout after provider policy is absent", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["airport/Provider", "Custom"] }],
      proxies: {
        G: { name: "G", type: "Selector", all: ["airport/Provider", "Custom"] },
        Custom: { name: "Custom", type: "Trojan" },
      },
      providers: { airport: { name: "airport", proxies: [{ name: "Provider", type: "Trojan" }] } },
    });
    const plan = planProxyGroupTests(store, makeGlobalProxyKey("G"), {
      pageFallback: { url: "https://page.test/204", timeoutMs: 4_321 },
    });
    const byKey = new Map(plan.targets.map((target) => [target.physicalKey, target.policy]));

    expect(byKey.get(makeProviderProxyKey("airport", "Provider"))).toMatchObject({ url: "https://page.test/204", timeoutMs: 4_321 });
    expect(byKey.get(makeGlobalProxyKey("Custom"))).toMatchObject({ url: "https://page.test/204", timeoutMs: 4_321 });
  });
});
