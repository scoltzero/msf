import { describe, expect, it } from "vitest";
import { normalizeProxySnapshot, makeGlobalProxyKey, makeProviderProxyKey } from "./normalize";
import { resolveProxyChain, searchProxyStore } from "./selectors";
import { compileSafeSearch } from "./search";
import { mergeStableOrder } from "./ordering";
import { DEFAULT_PROXY_SETTINGS, migrateProxySettings, PROXY_SETTINGS_KEY_V2, readProxySettings } from "./settings";
import { normalizeConfigAuthority } from "./configAuthority";
import { bucketProxyTests, resolveProxyTestPolicy, runControlledTests } from "./latency";

describe("mihomo proxy normalization", () => {
  const payload = {
    data: {
      groups: [{ name: "节点选择", type: "Selector", all: ["Same", "Direct"], now: "Same", order: 0 }],
      proxies: {
        "节点选择": { name: "节点选择", type: "Selector", all: ["Same", "Direct"], now: "Same" },
        Same: { name: "Same", type: "Trojan", delay: 22, alive: true },
        Direct: { name: "Direct", type: "Direct", alive: true },
      },
      providers: {
        airportA: { name: "airportA", proxies: [{ name: "Same", type: "Trojan", delay: 42 }] },
        airportB: { name: "airportB", proxies: [{ name: "Same", type: "Trojan", delay: 88 }] },
      },
    },
  };

  it("keeps provider-scoped same-name nodes and group references", () => {
    const store = normalizeProxySnapshot(payload, undefined, 100);
    expect(store.entities[makeGlobalProxyKey("Same")].delay).toBe(22);
    expect(store.entities[makeProviderProxyKey("airportA", "Same")].delay).toBe(42);
    expect(store.entities[makeProviderProxyKey("airportB", "Same")].delay).toBe(88);
    expect(store.entities[makeGlobalProxyKey("节点选择")].memberKeys).toContain(makeGlobalProxyKey("Same"));
    expect(store.providers.airportA.proxyKeys).toHaveLength(1);
    expect(store.providers.airportA.alive).toBeUndefined();
    expect(store.providers.airportA.total).toBeUndefined();
  });

  it("shares unchanged entity references between snapshots", () => {
    const first = normalizeProxySnapshot(payload, undefined, 100);
    const second = normalizeProxySnapshot(payload, first, 200);
    expect(second.entities[makeGlobalProxyKey("Same")]).toBe(first.entities[makeGlobalProxyKey("Same")]);
    expect(second.entities[makeProviderProxyKey("airportA", "Same")]).toBe(first.entities[makeProviderProxyKey("airportA", "Same")]);
    expect(second.groupKeys).toBe(first.groupKeys);
  });

  it("keeps proxy-group array order when config_order is absent", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "节点选择", type: "Selector", all: ["A"], now: "A" },
        { name: "手动切换", type: "Selector", all: ["A"], now: "A" },
        { name: "Netflix", type: "Selector", all: ["A"], now: "A" },
      ],
      proxies: {
        Netflix: { name: "Netflix", type: "Selector", all: ["A"], now: "A" },
        A: { name: "A", type: "Trojan", delay: 32 },
        "节点选择": { name: "节点选择", type: "Selector", all: ["A"], now: "A" },
        "手动切换": { name: "手动切换", type: "Selector", all: ["A"], now: "A" },
      },
    });
    expect(store.groupKeys.map((key) => store.entities[key].name)).toEqual(["节点选择", "手动切换", "Netflix"]);
  });
});

describe("proxy selectors and search", () => {
  it("resolves final selected node and detects cycles", () => {
    const store = normalizeProxySnapshot({
      groups: [
        { name: "A", type: "Selector", all: ["B"], now: "B" },
        { name: "B", type: "Selector", all: ["Exit"], now: "Exit" },
      ],
      proxies: {
        A: { name: "A", type: "Selector", all: ["B"], now: "B" },
        B: { name: "B", type: "Selector", all: ["Exit"], now: "Exit" },
        Exit: { name: "Exit", type: "Trojan", delay: 31 },
      },
    });
    const chain = resolveProxyChain(makeGlobalProxyKey("A"), store);
    expect(chain.finalKey).toBe(makeGlobalProxyKey("Exit"));
    expect(chain.cycleDetected).toBe(false);

    const cycle = normalizeProxySnapshot({
      groups: [{ name: "A", type: "Selector", all: ["B"], now: "B" }, { name: "B", type: "Selector", all: ["A"], now: "A" }],
      proxies: { A: { name: "A", type: "Selector", all: ["B"], now: "B" }, B: { name: "B", type: "Selector", all: ["A"], now: "A" } },
    });
    expect(resolveProxyChain(makeGlobalProxyKey("A"), cycle).cycleDetected).toBe(true);
  });

  it("rejects unsafe and malformed regex while keeping text search safe", () => {
    expect(compileSafeSearch("(a+)+$", { regex: true }).valid).toBe(false);
    expect(compileSafeSearch("[", { regex: true }).valid).toBe(false);
    expect(compileSafeSearch("机场").test("机场节点")).toBe(true);
    expect(compileSafeSearch("a".repeat(129), { regex: true }).error).toContain("128");
  });

  it("returns provider-aware global node results", () => {
    const store = normalizeProxySnapshot({ providers: { p: { name: "p", proxies: [{ name: "Tokyo", type: "Trojan" }] } }, proxies: { Group: { name: "Group", type: "Selector", all: ["Tokyo"] } } });
    const result = searchProxyStore(store, "Tokyo", "nodes");
    expect(result.results[0].providerName).toBe("p");
  });
});

describe("ordering, settings and authority", () => {
  it("merges local drag order and inserts new config keys stably", () => {
    expect(mergeStableOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["b", "c", "a", "d"]);
    expect(mergeStableOrder(["a", "b"], ["b", "stale", "b"])).toEqual(["a", "b"]);
  });

  it("migrates v1 settings and writes a version 3 shape", () => {
    const values = new Map<string, string>([["msf-mihomo-proxies.settings", JSON.stringify({ doubleColumn: false, delayTestUrl: " https://example.test " })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    const settings = readProxySettings(storage);
    expect(settings.version).toBe(3);
    expect(settings.doubleColumn).toBe(false);
    expect(settings.delayTestUrl).toBe("https://example.test");
    expect(settings.groupProxiesByProvider).toBe(DEFAULT_PROXY_SETTINGS.groupProxiesByProvider);
    expect(settings.proxyPreviewType).toBe("auto");
    expect(values.has(PROXY_SETTINGS_KEY_V2)).toBe(true);
    expect(migrateProxySettings({ version: 1 }).migrated).toBe(true);
  });

  it("repairs missing and invalid v3 fields without exposing legacy thresholds", () => {
    const migrated = migrateProxySettings({
      version: 3,
      groupProxiesByProvider: "yes",
      minProxyCardWidth: "not-a-number",
      proxyPreviewType: "unknown",
      proxyCardSize: "large",
      proxyGroupIconSize: 1000,
      proxyGroupIconMargin: -10,
      delayTestUrl: "javascript:alert(1)",
      delayTimeoutMs: 9,
      delayLowMs: 900,
      delayHighMs: 200,
    });

    expect(migrated.migrated).toBe(true);
    expect(migrated.settings.version).toBe(3);
    expect(migrated.settings.groupProxiesByProvider).toBe(false);
    expect(migrated.settings.minProxyCardWidth).toBe(DEFAULT_PROXY_SETTINGS.minProxyCardWidth);
    expect(migrated.settings.proxyPreviewType).toBe("auto");
    expect(migrated.settings.proxyCardSize).toBe("comfortable");
    expect(migrated.settings.proxyGroupIconSize).toBe(64);
    expect(migrated.settings.proxyGroupIconMargin).toBe(0);
    expect(migrated.settings.delayTestUrl).toBe(DEFAULT_PROXY_SETTINGS.delayTestUrl);
    expect(migrated.settings.delayTimeoutMs).toBe(1_000);
    expect(migrated.settings.delayHighMs).toBeGreaterThanOrEqual(migrated.settings.delayLowMs);
  });

  it("accepts Zashboard-style aliases while keeping the MSF key stable", () => {
    const migrated = migrateProxySettings({
      version: 2,
      groupByProvider: true,
      manageHiddenGroup: true,
      showFinalOutbound: true,
      disableTextSelect: false,
      minNodeCardWidth: 180,
      nodePreviewType: "dots",
      nodeCardSize: "small",
      groupIconSize: 28,
      groupIconMargin: 8,
    });

    expect(migrated.settings.groupProxiesByProvider).toBe(true);
    expect(migrated.settings.manageHiddenGroups).toBe(true);
    expect(migrated.settings.displayFinalOutbound).toBe(true);
    expect(migrated.settings.disableProxiesPageTextSelect).toBe(false);
    expect(migrated.settings.minProxyCardWidth).toBe(180);
    expect(migrated.settings.proxyPreviewType).toBe("dots");
    expect(migrated.settings.proxyCardSize).toBe("compact");
    expect(migrated.settings.proxyGroupIconSize).toBe(28);
    expect(migrated.settings.proxyGroupIconMargin).toBe(8);
  });

  it("uses explicit backend edit permissions", () => {
    const generated = normalizeConfigAuthority({ data: { mode: "generated", active_name: "custom-looking.yaml", can_edit_groups: false } });
    const custom = normalizeConfigAuthority({ mode: "custom", can_edit_groups: true, can_edit_providers: false });
    expect(generated.canEditGroups).toBe(false);
    expect(custom.canEditGroups).toBe(true);
    expect(custom.canEditProviders).toBe(false);
  });
});

describe("latency policy and jobs", () => {
  it("follows temporary > group > provider > fallback precedence", () => {
    expect(resolveProxyTestPolicy({ temporary: "https://temporary", group: "https://group", provider: "https://provider", pageFallback: "https://page" }).source).toBe("temporary");
    expect(resolveProxyTestPolicy({ group: "https://group", provider: "https://provider", pageFallback: "https://page" }).url).toBe("https://group");
    expect(resolveProxyTestPolicy({ scope: "provider", group: "https://group", provider: "https://provider", pageFallback: "https://page" }).url).toBe("https://provider");
  });

  it("buckets a mixed-provider group by the actual policy", () => {
    const store = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["A", "B"] }],
      proxies: { G: { name: "G", type: "Selector", all: ["A", "B"] } },
      providers: {
        p1: { name: "p1", test_policy: { url: "https://one", timeoutMs: 1000 }, proxies: [{ name: "A" }] },
        p2: { name: "p2", test_policy: { url: "https://two", timeoutMs: 1000 }, proxies: [{ name: "B" }] },
      },
    });
    const buckets = bucketProxyTests(store, makeGlobalProxyKey("G"));
    expect(buckets).toHaveLength(2);
  });

  it("runs bounded tests and reports every completion", async () => {
    const progress: number[] = [];
    const results = await runControlledTests(["a", "b", "c"], async (key) => key.toUpperCase(), { concurrency: 2, onProgress: (_result, completed) => progress.push(completed) });
    expect(results.map((item) => item.value).sort()).toEqual(["A", "B", "C"]);
    expect(progress).toHaveLength(3);
  });
});
