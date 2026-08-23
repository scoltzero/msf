"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EChartCanvas, echarts, type EChartsOption } from "@/components/charts/EChartCanvas";
import { latestTimestamp, timestampMs } from "@/components/charts/timeSeries";
import { namedTimeValue, nextStableScale, type StableScaleState } from "@/components/charts/chartStability";

export type ChartPoint = {
  timestamp?: unknown;
  time?: unknown;
  cpuPercent?: unknown;
  memoryPercent?: unknown;
  downloadSpeed?: unknown;
  uploadSpeed?: unknown;
  connections?: unknown;
};

function initialRatePoints(end: number, windowSeconds: number): ChartPoint[] {
  const count = Math.max(3, Math.round(windowSeconds) + 2);
  return Array.from({ length: count }, (_, index) => ({
    timestamp: end - (count - 1 - index) * 1000,
    downloadSpeed: 0,
    uploadSpeed: 0,
    connections: 0,
  }));
}

function mergeRatePoints(placeholders: ChartPoint[], samples: ChartPoint[], latest: number, windowSeconds: number) {
  const byTimestamp = new Map<number, ChartPoint>();
  for (const point of [...placeholders, ...samples]) {
    const time = timestampMs(point.timestamp ?? point.time);
    if (time > 0) byTimestamp.set(time, point);
  }
  const cutoff = latest - (windowSeconds + 2) * 1000;
  return Array.from(byTimestamp.entries())
    .filter(([time]) => time >= cutoff)
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
}

export const SYSTEM_CHART_COLORS = {
  cpu: "oklch(60% 0.21 235)",
  memory: "rgb(147, 51, 234)",
  upload: "rgb(74, 222, 128)",
  download: "rgb(96, 165, 250)",
  connections: "rgb(139, 92, 246)",
} as const;

const CPU_COLOR = SYSTEM_CHART_COLORS.cpu;
const MEMORY_COLOR = SYSTEM_CHART_COLORS.memory;
const UPLOAD_COLOR = SYSTEM_CHART_COLORS.upload;
const DOWNLOAD_COLOR = SYSTEM_CHART_COLORS.download;
const CONNECTION_COLOR = SYSTEM_CHART_COLORS.connections;

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatByteRate(value: unknown) {
  const bytes = Math.max(0, numberValue(value));
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB/s`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${bytes.toFixed(0)} B/s`;
}

function formatTooltipTime(value: unknown) {
  const date = new Date(timestampMs(value) || Date.now());
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function useDarkTheme() {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function stableTimePoint(point: ChartPoint, value: unknown) {
  return namedTimeValue(point.timestamp ?? point.time, value);
}

function timePair(point: ChartPoint, value: unknown): [number, number] {
  return [timestampMs(point.timestamp ?? point.time) || Date.now(), numberValue(value)];
}

function baseOption(dark: boolean, start: number, end: number): EChartsOption {
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    backgroundColor: "transparent",
    animationDurationUpdate: reducedMotion ? 0 : 1000,
    animationEasingUpdate: "linear",
    grid: { left: 0, top: 0, right: 0, bottom: 0, containLabel: false },
    xAxis: {
      type: "time",
      show: false,
      min: start,
      max: end,
    },
    tooltip: {
      show: true,
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "line",
        lineStyle: { color: "oklch(70% 0.03 250)", width: 1.2, type: "dashed" },
      },
      backgroundColor: dark ? "rgba(20,20,23,.94)" : "rgba(255,255,255,.96)",
      borderColor: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)",
      padding: [8, 10],
      textStyle: { color: dark ? "#f4f4f5" : "#27272a", fontSize: 11 },
    },
  };
}

function areaGradient(color: string, bottom: string) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color },
    { offset: 1, color: bottom },
  ]);
}

export function TrendChart({
  points = [],
  cpuPercent = 0,
  memoryPercent = 0,
  scaleMax = 100,
  windowSeconds = 180,
}: {
  points?: ChartPoint[];
  cpuPercent?: unknown;
  memoryPercent?: unknown;
  scaleMax?: number;
  windowSeconds?: number;
}) {
  const dark = useDarkTheme();
  const chartPoints = useMemo<ChartPoint[]>(
    () => points.length ? points : [{ timestamp: Date.now(), cpuPercent, memoryPercent }],
    [cpuPercent, memoryPercent, points],
  );
  const latest = latestTimestamp(chartPoints);
  const option = useMemo<EChartsOption>(() => ({
    ...baseOption(dark, latest - windowSeconds * 1000, latest),
    tooltip: {
      ...(baseOption(dark, latest - windowSeconds * 1000, latest).tooltip as object),
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        const time = rows[0]?.value?.[0];
        const values = new Map(rows.map((row: any) => [row.seriesName, numberValue(row.value?.[1])]));
        return `<div style="font-weight:600;margin-bottom:6px">${formatTooltipTime(time)}</div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:${CPU_COLOR}">CPU</span><b>${(values.get("CPU") ?? 0).toFixed(1)}%</b></div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:${MEMORY_COLOR}">内存</span><b>${(values.get("内存") ?? 0).toFixed(1)}%</b></div>`;
      },
    },
    yAxis: {
      type: "value",
      show: false,
      min: 0,
      max: Math.max(1, scaleMax),
      splitNumber: 4,
      splitLine: { show: true, lineStyle: { color: dark ? "rgba(255,255,255,.06)" : "rgba(35,38,45,.06)", width: 0.3 } },
    },
    series: [
      {
        type: "line",
        name: "内存",
        symbol: "none",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: MEMORY_COLOR, cap: "round", join: "round" },
        areaStyle: { color: areaGradient("rgba(147,51,234,.30)", "rgba(147,51,234,.05)") },
        data: chartPoints.map((point) => timePair(point, point.memoryPercent)),
        emphasis: { disabled: true },
      },
      {
        type: "line",
        name: "CPU",
        symbol: "none",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: CPU_COLOR, cap: "round", join: "round" },
        areaStyle: { color: areaGradient("oklch(60% 0.21 235 / .30)", "oklch(60% 0.21 235 / .05)") },
        data: chartPoints.map((point) => timePair(point, point.cpuPercent)),
        emphasis: { disabled: true },
      },
    ],
  }), [chartPoints, dark, latest, scaleMax, windowSeconds]);

  return <EChartCanvas option={option} className="cursor-crosshair" />;
}

export function RateChart({
  points = [],
  downloadSpeed = 0,
  uploadSpeed = 0,
  connections = 0,
  windowSeconds = 60,
}: {
  points?: ChartPoint[];
  downloadSpeed?: unknown;
  uploadSpeed?: unknown;
  connections?: unknown;
  windowSeconds?: number;
}) {
  const dark = useDarkTheme();
  const chartPoints = useMemo<ChartPoint[]>(
    () => points.length ? points : [{ timestamp: Date.now(), downloadSpeed, uploadSpeed, connections }],
    [connections, downloadSpeed, points, uploadSpeed],
  );
  const latest = latestTimestamp(chartPoints);
  const placeholderRef = useRef<{ range: number; points: ChartPoint[] }>({
    range: windowSeconds,
    points: initialRatePoints(latest, windowSeconds),
  });
  if (placeholderRef.current.range !== windowSeconds) {
    placeholderRef.current = { range: windowSeconds, points: initialRatePoints(latest, windowSeconds) };
  }
  const bufferedPoints = useMemo(
    () => mergeRatePoints(placeholderRef.current.points, chartPoints, latest, windowSeconds),
    [chartPoints, latest, windowSeconds],
  );
  const axisEnd = latest - 1000;
  const scaleKey = latest;
  const rateScaleRef = useRef<{ range: number; key: number; state?: StableScaleState }>({ range: windowSeconds, key: 0 });
  const connectionScaleRef = useRef<{ range: number; key: number; state?: StableScaleState }>({ range: windowSeconds, key: 0 });
  if (rateScaleRef.current.range !== windowSeconds) rateScaleRef.current = { range: windowSeconds, key: 0 };
  if (connectionScaleRef.current.range !== windowSeconds) connectionScaleRef.current = { range: windowSeconds, key: 0 };
  if (rateScaleRef.current.key !== scaleKey || !rateScaleRef.current.state) {
    rateScaleRef.current.key = scaleKey;
    rateScaleRef.current.state = nextStableScale(
      rateScaleRef.current.state,
      Math.max(...bufferedPoints.flatMap((point) => [numberValue(point.downloadSpeed), numberValue(point.uploadSpeed)]), 0),
      512 * 1024,
    );
  }
  if (connectionScaleRef.current.key !== scaleKey || !connectionScaleRef.current.state) {
    connectionScaleRef.current.key = scaleKey;
    connectionScaleRef.current.state = nextStableScale(
      connectionScaleRef.current.state,
      Math.max(...bufferedPoints.map((point) => numberValue(point.connections)), 0),
      100,
    );
  }
  const maxRate = rateScaleRef.current.state.ceiling;
  const maxConnections = connectionScaleRef.current.state.ceiling;
  const option = useMemo<EChartsOption>(() => ({
    ...baseOption(dark, axisEnd - windowSeconds * 1000, axisEnd),
    tooltip: {
      ...(baseOption(dark, axisEnd - windowSeconds * 1000, axisEnd).tooltip as object),
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        const time = rows[0]?.value?.[0];
        const values = new Map(rows.map((row: any) => [row.seriesName, numberValue(row.value?.[1])]));
        return `<div style="font-weight:600;margin-bottom:6px">${formatTooltipTime(time)}</div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:${CONNECTION_COLOR}">连接数</span><b>${Math.round(values.get("连接数") ?? 0)}</b></div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:${UPLOAD_COLOR}">上传速度</span><b>${formatByteRate(values.get("上传速度"))}</b></div><div style="display:flex;justify-content:space-between;gap:20px"><span style="color:${DOWNLOAD_COLOR}">下载速度</span><b>${formatByteRate(values.get("下载速度"))}</b></div>`;
      },
    },
    yAxis: [
      { type: "value", show: false, min: 0, max: maxRate, splitNumber: 4, splitLine: { show: true, lineStyle: { color: dark ? "rgba(255,255,255,.06)" : "rgba(35,38,45,.06)", width: 0.3 } } },
      { type: "value", show: false, min: 0, max: maxConnections, splitLine: { show: false } },
    ],
    series: [
      {
        id: "download-speed", type: "line", name: "下载速度", yAxisIndex: 0, symbol: "none", smooth: 0.2, showSymbol: false,
        lineStyle: { width: 1.5, color: DOWNLOAD_COLOR, cap: "round", join: "round" },
        areaStyle: { color: areaGradient("rgba(96,165,250,.28)", "rgba(96,165,250,.04)") },
        data: bufferedPoints.map((point) => stableTimePoint(point, point.downloadSpeed)), emphasis: { disabled: true },
      },
      {
        id: "upload-speed", type: "line", name: "上传速度", yAxisIndex: 0, symbol: "none", smooth: 0.2, showSymbol: false,
        lineStyle: { width: 1.5, color: UPLOAD_COLOR, cap: "round", join: "round" },
        areaStyle: { color: areaGradient("rgba(74,222,128,.26)", "rgba(74,222,128,.04)") },
        data: bufferedPoints.map((point) => stableTimePoint(point, point.uploadSpeed)), emphasis: { disabled: true },
      },
      {
        id: "connections", type: "line", name: "连接数", yAxisIndex: 1, symbol: "none", smooth: 0.2, showSymbol: false,
        lineStyle: { width: 1.5, color: CONNECTION_COLOR, cap: "round", join: "round" },
        areaStyle: { color: areaGradient("rgba(139,92,246,.24)", "rgba(139,92,246,.04)") },
        data: bufferedPoints.map((point) => stableTimePoint(point, point.connections)), emphasis: { disabled: true },
      },
    ],
  }), [axisEnd, bufferedPoints, dark, maxConnections, maxRate, windowSeconds]);

  return <EChartCanvas option={option} className="cursor-crosshair" />;
}
