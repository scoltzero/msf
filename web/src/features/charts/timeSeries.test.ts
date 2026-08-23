import { describe, expect, it } from "vitest";
import { mergeFrozenTimePoints, mergeTimePoints, timestampMs, withinTimeWindow } from "@/components/charts/timeSeries";
import { delayedTimePoints, namedTimeValue, nextStableScale } from "@/components/charts/chartStability";
import { freezeTrend, makeTrend, runtimeMetrics } from "@/app/mosdns/overview/page";

describe("timeSeries", () => {
  it("normalizes seconds, milliseconds, dates and ISO strings", () => {
    expect(timestampMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(timestampMs(1_700_000_000_123)).toBe(1_700_000_000_123);
    expect(timestampMs(new Date("2026-08-09T00:00:00Z"))).toBe(Date.parse("2026-08-09T00:00:00Z"));
    expect(timestampMs("2026-08-09T00:00:00Z")).toBe(Date.parse("2026-08-09T00:00:00Z"));
  });

  it("keeps points inside a real time window", () => {
    const points = [0, 10, 20, 30].map((seconds) => ({ timestamp: 1_700_000_000_000 + seconds * 1000, value: seconds }));
    expect(withinTimeWindow(points, 15).map((point) => point.value)).toEqual([20, 30]);
  });

  it("sorts, deduplicates and prunes rolling history", () => {
    const base = 1_700_000_000_000;
    const merged = mergeTimePoints(
      [{ timestamp: base + 10_000, value: "old" }, { timestamp: base + 20_000, value: "old-value" }],
      [{ timestamp: base + 20_000, value: "new-value" }, { timestamp: base + 30_000, value: "new" }],
      15,
    );
    expect(merged).toEqual([
      { timestamp: base + 20_000, value: "new-value" },
      { timestamp: base + 30_000, value: "new" },
    ]);
  });

  it("does not rewrite an existing historical sample", () => {
    const base = 1_700_000_000_000;
    expect(mergeFrozenTimePoints(
      [{ timestamp: base, value: "confirmed" }],
      [{ timestamp: base, value: "recalculated" }, { timestamp: base + 1000, value: "new" }],
      10,
    )).toEqual([
      { timestamp: base, value: "confirmed" },
      { timestamp: base + 1000, value: "new" },
    ]);
  });

  it("keeps stable point names and delays the newest sample by one frame", () => {
    expect(namedTimeValue(1_700_000_000, 12)).toEqual({
      name: "1700000000000",
      value: [1_700_000_000_000, 12],
    });
    expect(delayedTimePoints([1, 2, 3])).toEqual([1, 2]);
  });

  it("raises the scale immediately and lowers it only after the hold period", () => {
    const initial = nextStableScale(undefined, 100, 100, 3);
    const raised = nextStableScale(initial, 600, 100, 3);
    expect(raised.ceiling).toBeGreaterThan(initial.ceiling);
    const low1 = nextStableScale(raised, 100, 100, 3);
    const low2 = nextStableScale(low1, 100, 100, 3);
    expect(low2.ceiling).toBe(raised.ceiling);
    expect(nextStableScale(low2, 100, 100, 3).ceiling).toBe(initial.ceiling);
  });

  it("aligns MosDNS buckets to whole seconds and excludes the unfinished bucket", () => {
    const trend = makeTrend([
      { timestamp: 0.5, duration_ms: 10 },
      { timestamp: 9, duration_ms: 20 },
      { timestamp: 10, duration_ms: 30 },
    ], 10, 10_500);
    expect(trend.buckets[0]).toEqual({ timestamp: 1000, queries: 1, durationMs: 10 });
    expect(trend.buckets.at(-1)).toEqual({ timestamp: 10_000, queries: 1, durationMs: 20 });
    expect(trend.buckets.reduce((sum, bucket) => sum + bucket.queries, 0)).toBe(2);
  });

  it("freezes overlapping finalized MosDNS buckets", () => {
    const previous = { buckets: [{ timestamp: 2000, queries: 4, durationMs: 12 }] };
    const incoming = { buckets: [
      { timestamp: 2000, queries: 9, durationMs: 50 },
      { timestamp: 3000, queries: 1, durationMs: 8 },
    ] };
    expect(freezeTrend(previous, incoming).buckets).toEqual([
      { timestamp: 2000, queries: 4, durationMs: 12 },
      { timestamp: 3000, queries: 1, durationMs: 8 },
    ]);
  });

  it("does not mix audit query totals with all-time cache counters", () => {
    const metrics = runtimeMetrics({
      query_count: 5000,
      stats: { cache_hit_total: 185707 },
    });
    expect(metrics.top.find((metric) => metric.label === "缓存命中率")?.value).toBe("—");
  });

  it("calculates cache hit rate only from a matching cache total", () => {
    const metrics = runtimeMetrics({
      stats: { cache_query_total: 200, cache_hit_total: 190 },
    });
    expect(metrics.top.find((metric) => metric.label === "缓存命中率")?.value).toBe("95.0%");
  });
});
