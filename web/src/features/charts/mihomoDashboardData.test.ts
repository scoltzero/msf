import { describe, expect, it } from "vitest";
import {
  mergeMihomoTrafficHistory,
  normalizeMihomoConnections,
  normalizeMihomoProviderTraffic,
  normalizeMihomoRuleHits,
} from "@/components/dashboard/data";
import { calculateLatencyStats, providerUsage, ruleHitDisplayLimit } from "@/components/dashboard/widgets/mihomo";

describe("Mihomo dashboard shared models", () => {
  it("normalizes active connections for all five aggregation fields", () => {
    const [row] = normalizeMihomoConnections({ connections: [{
      id: "1", metadata: { sourceIP: "10.0.0.2", host: "example.com", process: "curl" }, chains: ["节点 A", "策略组"], download: 12, upload: 3,
    }] });
    expect(row).toMatchObject({ id: "1", source: "10.0.0.2", target: "example.com", process: "curl", outbound: "节点 A", proxyGroup: "策略组", download: 12, upload: 3 });
  });

  it("normalizes provider quota and applies 70/90 warning thresholds", () => {
    const rows = normalizeMihomoProviderTraffic({ data: { providers: { demo: { subscriptionInfo: { Upload: 10, Download: 60, Total: 100 } } } } });
    expect(rows[0]).toMatchObject({ name: "demo", used: 70, total: 100 });
    expect(providerUsage(rows[0])).toMatchObject({ percent: 70, remaining: 30, tone: "warning" });
    expect(providerUsage({ used: 95, total: 100 }).tone).toBe("danger");
  });

  it("does not invent zero hits when extra.hitCount is absent", () => {
    const rules = normalizeMihomoRuleHits({ data: { rules: [
      { type: "DOMAIN", payload: "missing.test", extra: { updatedAt: 1 } },
      { type: "DOMAIN", payload: "zero.test", extra: { hitCount: 0 } },
      { type: "DOMAIN", payload: "hit.test", extra: { hitCount: 5 } },
    ] } });
    expect(rules.map((row) => [row.name, row.hits])).toEqual([
      ["DOMAIN · hit.test", 5],
      ["DOMAIN · zero.test", 0],
    ]);
  });

  it("keeps frozen traffic points and prunes only outside retention", () => {
    const first = { timestamp: 1_000, downloadSpeed: 1, uploadSpeed: 2, connections: 3 };
    const next = { timestamp: 3_000, downloadSpeed: 4, uploadSpeed: 5, connections: 6 };
    expect(mergeMihomoTrafficHistory([first], next, 2_500)).toEqual([first, next]);
    expect(first.downloadSpeed).toBe(1);
  });

  it("calculates successful latency rounds and size-specific rule limits", () => {
    const stats = calculateLatencyStats([
      { targetId: "baidu", round: 1, elapsedMs: 20, ok: true, at: 1 },
      { targetId: "baidu", round: 2, elapsedMs: 40, ok: true, at: 2 },
      { targetId: "baidu", round: 3, elapsedMs: 0, ok: false, at: 3 },
    ]);
    expect(stats).toEqual({ min: 20, avg: 30, max: 40, successes: 2 });
    expect([ruleHitDisplayLimit("s"), ruleHitDisplayLimit("m"), ruleHitDisplayLimit("l")]).toEqual([10, 16, 24]);
  });
});
