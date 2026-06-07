import { useId, useMemo, useState } from "react";

/**
 * Hand-rolled SVG charts matching the live site (viewBox 0 0 300 100, 5 gridlines).
 */

export type ChartPoint = {
  timestamp?: unknown;
  time?: unknown;
  cpuPercent?: unknown;
  memoryPercent?: unknown;
  downloadSpeed?: unknown;
  uploadSpeed?: unknown;
  connections?: unknown;
};

const GRID_Y = [0, 25, 50, 75, 100];

function Gridlines() {
  return (
    <>
      {GRID_Y.map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2="300"
          y2={y}
          stroke="currentColor"
          strokeWidth="0.3"
          className="text-muted-foreground/10"
        />
      ))}
    </>
  );
}

function linePath(values: number[]): string {
  const ys = values.length === 1 ? [values[0], values[0]] : values;
  if (ys.length === 0) return "";
  const step = ys.length > 1 ? 300 / (ys.length - 1) : 300;
  return ys.map((y, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/**
 * Quadratic-midpoint smoothing, identical to the live site: each data point is
 * a control point and the curve passes through the midpoints between them.
 * Produces `M p0 Q p0,mid01 Q p1,mid12 … L pLast`.
 */
function smoothLinePath(values: number[]): string {
  const ys = values.length === 1 ? [values[0], values[0]] : values;
  const n = ys.length;
  if (n === 0) return "";
  const step = n > 1 ? 300 / (n - 1) : 300;
  const x = (i: number) => i * step;
  let path = `M ${x(0).toFixed(2)},${ys[0].toFixed(2)}`;
  if (n === 1) return path;
  for (let i = 1; i < n; i += 1) {
    const cx = x(i - 1);
    const cy = ys[i - 1];
    const mx = (x(i - 1) + x(i)) / 2;
    const my = (ys[i - 1] + ys[i]) / 2;
    path += ` Q ${cx.toFixed(2)},${cy.toFixed(2)} ${mx.toFixed(2)},${my.toFixed(2)}`;
  }
  path += ` L ${x(n - 1).toFixed(2)},${ys[n - 1].toFixed(2)}`;
  return path;
}

function areaPath(values: number[], smooth = false): string {
  const path = smooth ? smoothLinePath(values) : linePath(values);
  return path ? `${path} L300,100 L0,100 Z` : "";
}

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function clampPercent(value: unknown, scaleMax = 100) {
  const scale = Math.max(1, Number(scaleMax) || 100);
  return Math.max(0, Math.min(numberValue(value), scale));
}

function valuesOrCurrent(points: ChartPoint[], key: keyof ChartPoint, fallback: unknown) {
  if (points.length > 0) {
    return points.map((point) => point[key]);
  }
  return [fallback];
}

function percentLine(values: unknown[], scaleMax = 100) {
  const scale = Math.max(1, Number(scaleMax) || 100);
  return values.map((value) => 100 - (clampPercent(value, scale) / scale) * 100);
}

function rateLine(values: unknown[], max: number) {
  return values.map((value) => {
    const numeric = numberValue(value);
    return max > 0 ? 100 - Math.max(0, Math.min(numeric / max, 1)) * 88 : 100;
  });
}

function chartPointX(index: number, total: number) {
  if (total <= 1) return 150;
  return (index / (total - 1)) * 300;
}

function formatByteRate(value: unknown) {
  const bytes = Math.max(0, numberValue(value));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${bytes.toFixed(0)} B/s`;
}

function formatTooltipTime(value: unknown) {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value > 10_000_000_000 ? value : value * 1000);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  } else {
    date = new Date();
  }
  if (Number.isNaN(date.getTime())) date = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function TrendChart({
  points = [],
  cpuPercent = 0,
  memoryPercent = 0,
  scaleMax = 100,
}: {
  points?: ChartPoint[];
  cpuPercent?: unknown;
  memoryPercent?: unknown;
  scaleMax?: number;
}) {
  const cpuYs = percentLine(valuesOrCurrent(points, "cpuPercent", cpuPercent), scaleMax);
  const memoryYs = percentLine(valuesOrCurrent(points, "memoryPercent", memoryPercent), scaleMax);
  return (
    <svg
      viewBox="0 0 300 100"
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <Gridlines />
      <defs>
        <linearGradient id="cpuGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="oklch(60% 0.21 235)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="oklch(60% 0.21 235)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="memoryGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgb(147, 51, 234)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(147, 51, 234)" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d={areaPath(memoryYs, true)} fill="url(#memoryGradient)" />
      <path
        d={smoothLinePath(memoryYs)}
        fill="none"
        stroke="rgb(147, 51, 234)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={areaPath(cpuYs, true)} fill="url(#cpuGradient)" />
      <path
        d={smoothLinePath(cpuYs)}
        fill="none"
        stroke="oklch(60% 0.21 235)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RateChart({
  points = [],
  downloadSpeed = 0,
  uploadSpeed = 0,
  connections = 0,
}: {
  points?: ChartPoint[];
  downloadSpeed?: unknown;
  uploadSpeed?: unknown;
  connections?: unknown;
}) {
  const id = useId().replace(/:/g, "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartPoints = useMemo<ChartPoint[]>(
    () => points.length > 0 ? points : [{ downloadSpeed, uploadSpeed, connections, timestamp: Date.now() }],
    [connections, downloadSpeed, points, uploadSpeed]
  );
  const dlValues = valuesOrCurrent(chartPoints, "downloadSpeed", downloadSpeed);
  const ulValues = valuesOrCurrent(chartPoints, "uploadSpeed", uploadSpeed);
  const connValues = valuesOrCurrent(chartPoints, "connections", connections);
  const maxRate = Math.max(...dlValues.map(numberValue), ...ulValues.map(numberValue), 1);
  const maxConnections = Math.max(...connValues.map(numberValue), 100);
  const dlYs = rateLine(dlValues, maxRate);
  const ulYs = rateLine(ulValues, maxRate);
  const connYs = rateLine(connValues, maxConnections);
  const activeIndex = hoverIndex == null ? null : Math.max(0, Math.min(hoverIndex, chartPoints.length - 1));
  const activePoint = activeIndex == null ? null : chartPoints[activeIndex];
  const hoverX = activeIndex == null ? 0 : chartPointX(activeIndex, chartPoints.length);
  const tooltipX = Math.max(0, Math.min(100, (hoverX / 300) * 100));

  return (
    <div
      className="relative h-full w-full"
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
        const nextIndex = Math.round(Math.max(0, Math.min(1, ratio)) * Math.max(chartPoints.length - 1, 0));
        setHoverIndex(nextIndex);
      }}
    >
      <svg
        viewBox="0 0 300 100"
        className="h-full w-full cursor-crosshair"
        preserveAspectRatio="none"
      >
        <Gridlines />
        <defs>
          <linearGradient id={`dlGradient-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="oklch(60% 0.21 235)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="oklch(60% 0.21 235)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id={`ulGradient-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(22, 163, 74)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(22, 163, 74)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id={`connGradient-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(234, 179, 8)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(234, 179, 8)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaPath(dlYs, true)} fill={`url(#dlGradient-${id})`} />
        <path
          d={smoothLinePath(dlYs)}
          fill="none"
          stroke="oklch(60% 0.21 235)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={areaPath(ulYs, true)} fill={`url(#ulGradient-${id})`} />
        <path
          d={smoothLinePath(ulYs)}
          fill="none"
          stroke="rgb(22, 163, 74)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={areaPath(connYs, true)} fill={`url(#connGradient-${id})`} />
        <path
          d={smoothLinePath(connYs)}
          fill="none"
          stroke="rgb(234, 179, 8)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {activePoint ? (
          <line
            x1={hoverX}
            y1="0"
            x2={hoverX}
            y2="100"
            stroke="oklch(70% 0.03 250)"
            strokeWidth="1.2"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {activePoint ? (
        <div
          className="pointer-events-none absolute top-7 z-20 w-[190px] rounded-lg border border-primary/50 bg-card/95 p-3 text-xs text-foreground shadow-lg backdrop-blur"
          style={{
            left: `${tooltipX}%`,
            transform: tooltipX > 68 ? "translateX(-100%)" : tooltipX < 32 ? "translateX(0)" : "translateX(-50%)",
          }}
        >
          <div className="mb-2 font-semibold">{formatTooltipTime(activePoint.timestamp ?? activePoint.time)}</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-amber-400" />连接数</span>
              <span className="font-semibold">{Math.round(numberValue(activePoint.connections))}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" />上传速度</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatByteRate(activePoint.uploadSpeed)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-sky-500" />下载速度</span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">{formatByteRate(activePoint.downloadSpeed)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
