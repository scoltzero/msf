import { describe, expect, it } from "vitest";
import { makeGlobalProxyKey, normalizeProxySnapshot } from "./normalize";
import { mergeProxyStore, patchProxyDelayKeys } from "./proxyStore";

describe("proxy delay attribution and refresh merging", () => {
  const groupKey = makeGlobalProxyKey("G");
  const nodeKey = makeGlobalProxyKey("Node");
  const snapshot = () => normalizeProxySnapshot({
    groups: [{ name: "G", type: "Selector", all: ["Node"], now: "Node" }],
    proxies: {
      G: { name: "G", type: "Selector", all: ["Node"], now: "Node" },
      Node: { name: "Node", type: "Trojan", delay: 0 },
    },
  });

  it("patches every display attribution key with one sampled result", () => {
    const next = patchProxyDelayKeys(snapshot(), [groupKey, nodeKey], 42, {
      delay: 42,
      timestamp: "2026-08-08T00:00:01.000Z",
      url: "https://example.test/204",
      success: true,
    });

    expect(next.entities[groupKey].delay).toBe(42);
    expect(next.entities[nodeKey].delay).toBe(42);
    expect(next.entities[groupKey].history.at(-1)?.url).toBe("https://example.test/204");
  });

  it("keeps a locally sampled delay when a stale refresh has no newer sample", () => {
    const local = patchProxyDelayKeys(snapshot(), [groupKey, nodeKey], 42, {
      delay: 42,
      timestamp: "2026-08-08T00:00:01.000Z",
      url: "https://example.test/204",
      success: true,
    });
    const stale = snapshot();
    const merged = mergeProxyStore(local, stale);

    expect(merged.entities[groupKey].delay).toBe(42);
    expect(merged.entities[nodeKey].delay).toBe(42);
  });

  it("accepts a refresh carrying a newer controller sample", () => {
    const local = patchProxyDelayKeys(snapshot(), [groupKey, nodeKey], 42, {
      delay: 42,
      timestamp: "2026-08-08T00:00:01.000Z",
      url: "https://example.test/204",
      success: true,
    });
    const newer = normalizeProxySnapshot({
      groups: [{ name: "G", type: "Selector", all: ["Node"], now: "Node" }],
      proxies: {
        G: { name: "G", type: "Selector", all: ["Node"], now: "Node", delay: 99, history: [{ delay: 99, timestamp: "2026-08-08T00:00:02.000Z" }] },
        Node: { name: "Node", type: "Trojan", delay: 99, history: [{ delay: 99, timestamp: "2026-08-08T00:00:02.000Z" }] },
      },
    });
    const merged = mergeProxyStore(local, newer);

    expect(merged.entities[groupKey].delay).toBe(99);
    expect(merged.entities[nodeKey].delay).toBe(99);
  });
});
