import { describe, expect, it } from "vitest";
import { calculateLatencyStats, LATENCY_TARGETS, runLatencyTargetRounds } from "./MihomoLatencyWidget";
import type { FaviconSample, FaviconTarget } from "@/components/mihomo/overview/telemetry";

describe("MihomoLatencyWidget", () => {
  it("keeps the four fixed website targets", () => {
    expect(LATENCY_TARGETS.map((target) => target.label)).toEqual(["百度", "Google", "GitHub", "Cloudflare"]);
  });

  it("calculates statistics from successful rounds only", () => {
    const samples: FaviconSample[] = [
      { targetId: "baidu", round: 1, elapsedMs: 100, ok: true, at: 1 },
      { targetId: "baidu", round: 2, elapsedMs: 200, ok: true, at: 2 },
      { targetId: "baidu", round: 3, elapsedMs: 999, ok: false, at: 3 },
    ];
    expect(calculateLatencyStats(samples)).toEqual({ min: 100, avg: 150, max: 200, successes: 2 });
  });

  it("caps concurrent target runners", async () => {
    const targets: FaviconTarget[] = Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, label: `${index}`, url: `https://${index}.test/favicon.ico` }));
    let active = 0;
    let peak = 0;
    const runner = async (ownTargets: FaviconTarget[], rounds: number, onSample?: (sample: FaviconSample) => void) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const sample = { targetId: ownTargets[0].id, round: rounds, elapsedMs: 10, ok: true, at: 1 };
      onSample?.(sample);
      active -= 1;
      return [sample];
    };
    const samples = await runLatencyTargetRounds(targets, 1, undefined, 2, runner);
    expect(peak).toBe(2);
    expect(samples).toHaveLength(5);
  });
});
