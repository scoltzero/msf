import { describe, expect, it } from "vitest";
import {
  mergeSystemHistory,
  normalizeDashboardService,
  normalizeSystemMonitorPoint,
  parseSseBlocks,
} from "@/components/dashboard/data";
import { SYSTEM_CHART_COLORS } from "@/components/dashboard/charts";

describe("system dashboard shared data", () => {
  it("normalizes nested monitor fields and seconds timestamps", () => {
    expect(normalizeSystemMonitorPoint({
      timestamp: 1_700_000_000,
      cpu_percent: "12.5",
      mem_percent: 44,
      network: { download_speed: 1024, uploadSpeed: 2048, connection_count: 7 },
    })).toEqual({
      timestamp: 1_700_000_000_000,
      cpuPercent: 12.5,
      memoryPercent: 44,
      downloadSpeed: 1024,
      uploadSpeed: 2048,
      connections: 7,
    });
  });

  it("deduplicates shared history without mutating frozen old samples", () => {
    const now = 1_700_000_100_000;
    const original = normalizeSystemMonitorPoint({ timestamp: now - 2_000, cpu: 1 })!;
    const replacement = normalizeSystemMonitorPoint({ timestamp: now - 2_000, cpu: 9 })!;
    const latest = normalizeSystemMonitorPoint({ timestamp: now, cpu: 2 })!;
    const result = mergeSystemHistory([original], [replacement, latest], now, 60);
    expect(result).toHaveLength(2);
    expect(result[0].cpuPercent).toBe(9);
    expect(original.cpuPercent).toBe(1);
  });

  it("keeps an incomplete SSE block for the next network chunk", () => {
    const parsed = parseSseBlocks("event: monitor\ndata: {\"timestamp\":1}\n\nevent: monitor\ndata: {");
    expect(parsed.events).toEqual([{ event: "monitor", data: '{"timestamp":1}' }]);
    expect(parsed.rest).toBe("event: monitor\ndata: {");
  });

  it("normalizes service states and keeps unconfigured state explicit", () => {
    expect(normalizeDashboardService({ name: "singbox", installed: false })).toMatchObject({
      key: "singbox",
      configured: false,
      running: false,
    });
    expect(normalizeDashboardService({ name: "mosdns", status: "running", memory: "128 MB" })).toMatchObject({
      key: "mosdns",
      configured: true,
      running: true,
      memoryLabel: "128 MB",
    });
  });

  it("uses the accepted three-series palette", () => {
    expect(SYSTEM_CHART_COLORS.upload).toBe("rgb(74, 222, 128)");
    expect(SYSTEM_CHART_COLORS.download).toBe("rgb(96, 165, 250)");
    expect(SYSTEM_CHART_COLORS.connections).toBe("rgb(139, 92, 246)");
  });
});
