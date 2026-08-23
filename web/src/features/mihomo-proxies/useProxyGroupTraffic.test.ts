import { describe, expect, it } from "vitest";
import {
  aggregateProxyGroupTraffic,
  extractProxyConnections,
  normalizeProxyConnections,
  proxyGroupTrafficEqual,
  sampleProxyGroupTraffic,
  updateProxyGroupTraffic,
} from "./useProxyGroupTraffic";

type Connection = {
  id: string;
  upload: number;
  download: number;
  chains: string[];
};

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "one",
  upload: 100,
  download: 200,
  chains: ["Proxy A"],
  ...overrides,
});

describe("Mihomo proxy-group traffic sampling", () => {
  it("reports zero rates for the first sample", () => {
    const sampled = sampleProxyGroupTraffic(undefined, [connection()], 1_000);

    expect(sampled.traffic).toEqual({
      "Proxy A": { up: 0, down: 0, total: 0 },
    });
    expect(sampled.counters.get("one")).toEqual({
      upload: 100,
      download: 200,
      sampledAt: 1_000,
    });
  });

  it("accepts connections/items/data response envelopes", () => {
    const rows = [connection({ id: "envelope" })];
    const payloads = [
      rows,
      { connections: rows },
      { items: rows },
      { data: { connections: rows } },
      { data: { items: rows } },
      { data: { data: { connections: rows } } },
    ];

    for (const payload of payloads) {
      expect(extractProxyConnections(payload)).toHaveLength(1);
      expect(normalizeProxyConnections(payload)).toEqual([
        { id: "envelope", upload: 100, download: 200, chains: ["Proxy A"] },
      ]);
    }
  });

  it("derives two-second deltas and aggregates every chain name", () => {
    const first = sampleProxyGroupTraffic(undefined, [
      connection({ id: "one", chains: ["Proxy A", "Proxy B"], upload: 100, download: 200 }),
      connection({ id: "two", chains: ["Proxy B"], upload: 50, download: 100 }),
    ], 1_000);
    const second = sampleProxyGroupTraffic(first.counters, [
      connection({ id: "one", chains: ["Proxy A", "Proxy B"], upload: 300, download: 600 }),
      connection({ id: "two", chains: ["Proxy B"], upload: 150, download: 300 }),
    ], 3_000);

    expect(second.traffic).toEqual({
      "Proxy A": { up: 100, down: 200, total: 300 },
      "Proxy B": { up: 150, down: 300, total: 450 },
    });
  });

  it("counts a repeated chain name only once per connection", () => {
    const first = sampleProxyGroupTraffic(undefined, [
      connection({ chains: ["Proxy A", "Proxy A", "Proxy B"] }),
    ], 1_000);
    const second = sampleProxyGroupTraffic(first.counters, [
      connection({ upload: 300, download: 600, chains: ["Proxy A", "Proxy A", "Proxy B"] }),
    ], 3_000);

    expect(second.traffic).toEqual({
      "Proxy A": { up: 100, down: 200, total: 300 },
      "Proxy B": { up: 100, down: 200, total: 300 },
    });
  });

  it("reports a newly seen connection as zero until its next sample", () => {
    const first = sampleProxyGroupTraffic(undefined, [connection({ id: "existing" })], 1_000);
    const second = sampleProxyGroupTraffic(first.counters, [
      connection({ id: "existing", upload: 300, download: 600 }),
      connection({ id: "new", upload: 900, download: 1_000, chains: ["Proxy B"] }),
    ], 3_000);

    expect(second.traffic).toEqual({
      "Proxy A": { up: 100, down: 200, total: 300 },
      "Proxy B": { up: 0, down: 0, total: 0 },
    });
  });

  it("treats counter rollback as zero and uses the reset counter as the new baseline", () => {
    const first = sampleProxyGroupTraffic(undefined, [connection({ upload: 100, download: 200 })], 1_000);
    const rollback = sampleProxyGroupTraffic(first.counters, [connection({ upload: 10, download: 20 })], 3_000);
    const recovered = sampleProxyGroupTraffic(rollback.counters, [connection({ upload: 30, download: 40 })], 5_000);

    expect(rollback.traffic).toEqual({
      "Proxy A": { up: 0, down: 0, total: 0 },
    });
    expect(recovered.traffic).toEqual({
      "Proxy A": { up: 10, down: 10, total: 20 },
    });
  });

  it("drops ended connections from the next sample", () => {
    const first = sampleProxyGroupTraffic(undefined, [
      connection({ id: "active", chains: ["Proxy A"] }),
      connection({ id: "ended", chains: ["Proxy B"] }),
    ], 1_000);
    const second = sampleProxyGroupTraffic(first.counters, [
      connection({ id: "active", upload: 300, download: 600, chains: ["Proxy A"] }),
    ], 3_000);

    expect(second.counters.has("ended")).toBe(false);
    expect(second.traffic).toEqual({
      "Proxy A": { up: 100, down: 200, total: 300 },
    });
  });

  it("keeps total equal to upload plus download and exposes aggregate aliases", () => {
    const first = sampleProxyGroupTraffic(undefined, [connection()], 1_000);
    const traffic = aggregateProxyGroupTraffic(first.counters, [connection({ upload: 300, download: 600 })], 3_000).traffic;
    const aliasTraffic = updateProxyGroupTraffic(first.counters, [connection({ upload: 300, download: 600 })], 3_000).traffic;

    expect(traffic["Proxy A"].total).toBe(traffic["Proxy A"].up + traffic["Proxy A"].down);
    expect(aliasTraffic).toEqual(traffic);
  });

  it("keeps equal traffic snapshots referentially reusable", () => {
    const left = { "Proxy A": { up: 10, down: 20, total: 30 } };
    const right = { "Proxy A": { up: 10, down: 20, total: 30 } };
    expect(proxyGroupTrafficEqual(left, right)).toBe(true);
    expect(proxyGroupTrafficEqual(left, { "Proxy A": { up: 11, down: 20, total: 31 } })).toBe(false);
    expect(proxyGroupTrafficEqual(left, {})).toBe(false);
  });
});
