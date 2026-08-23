import { describe, expect, it } from "vitest";
import { buildMosdnsTrend, freezeMosdnsTrend, normalizeMosdnsCaches, safePercent } from "./model";
import { taskProgressPercent } from "./MosdnsCacheSystemWidget";
import { runtimeMetricStyle } from "./MosdnsRuntimeWidget";
import { assertMosdnsActionSuccess, normalizeMosdnsTaskStatus } from "../../data/MosdnsDashboardProvider";

describe("MosDNS dashboard model", () => {
  it("never produces NaN for empty cache payloads", () => {
    const caches = normalizeMosdnsCaches({});
    for (const cache of Object.values(caches)) {
      expect(cache.hitRate).toBe(0);
      expect(cache.staleRate).toBe(0);
      expect(Number.isNaN(cache.entries)).toBe(false);
    }
    expect(safePercent(undefined, 1, 0)).toBe(0);
  });

  it("normalizes ratio and percentage forms", () => {
    expect(safePercent(.25)).toBe(25);
    expect(safePercent(25)).toBe(25);
    expect(safePercent(undefined, 1, 4)).toBe(25);
  });

  it("builds stable one-second buckets without future points", () => {
    const now = 1_700_000_010_500;
    const rows = buildMosdnsTrend([{ timestamp: now - 1500, duration_ms: 10 }, { timestamp: now + 5000, duration_ms: 99 }], 10, now);
    expect(rows).toHaveLength(10);
    expect(rows.reduce((sum, row) => sum + row.queries, 0)).toBe(1);
    expect(rows.every((row) => Number.isFinite(row.durationMs))).toBe(true);
    const changed = rows.map((row) => ({ ...row, queries: row.queries + 10 }));
    expect(freezeMosdnsTrend(rows, changed)).toEqual(rows);
  });

  it("keeps cache task status, progress, duration and recent records", () => {
    const status = normalizeMosdnsTaskStatus({
      task_status: {
        running: true,
        progress: 37.5,
        last_run_at: "2026-08-09 19:00:00",
        last_run_duration: "12 秒",
        records: [{ time: "19:00:01", message: "已生成国内缓存" }, "完成国外缓存"],
      },
    });
    expect(status).toEqual({
      currentStatus: "运行中",
      lastRunTime: "2026-08-09 19:00:00",
      lastRunRelative: "进度 37.5%",
      lastRunDuration: "12 秒",
      records: ["19:00:01 已生成国内缓存", "完成国外缓存"],
    });
    expect(taskProgressPercent(status.lastRunRelative)).toBe(37.5);
    expect(taskProgressPercent("5 分钟前")).toBeNull();
  });

  it("treats HTTP 200 with success false as a failed cache action", () => {
    expect(() => assertMosdnsActionSuccess({ success: false, error: "规则生成失败" })).toThrow("规则生成失败");
    expect(() => assertMosdnsActionSuccess({ data: { success: false, message: "写入失败" } })).toThrow("写入失败");
    expect(assertMosdnsActionSuccess({ success: true })).toEqual({ success: true });
  });

  it("keeps the original semantic tones for wide runtime metrics", () => {
    expect(runtimeMetricStyle("CPU 使用率").text).toContain("orange");
    expect(runtimeMetricStyle("进程内存 (RSS)").text).toContain("blue");
    expect(runtimeMetricStyle("堆内存使用").text).toContain("purple");
    expect(runtimeMetricStyle("GC 次数").text).toContain("amber");
    expect(runtimeMetricStyle("文件描述符").text).toContain("cyan");
  });
});
