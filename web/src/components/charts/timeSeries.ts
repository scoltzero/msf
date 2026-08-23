export const TIME_WINDOW_OPTIONS = [10, 15, 30, 60, 180, 300] as const;
export type TimeWindowSeconds = (typeof TIME_WINDOW_OPTIONS)[number];

export function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return 0;
  const text = value.trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(text) ? text.replace(" ", "T") : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestTimestamp(points: Array<{ timestamp?: unknown; time?: unknown }>, fallback = Date.now()) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = timestampMs(points[index].timestamp ?? points[index].time);
    if (value > 0) return value;
  }
  return fallback;
}

export function withinTimeWindow<T extends { timestamp?: unknown; time?: unknown }>(
  points: T[],
  seconds: number,
): T[] {
  if (points.length === 0) return [];
  const end = latestTimestamp(points);
  const start = end - Math.max(1, seconds) * 1000;
  return points.filter((point) => {
    const time = timestampMs(point.timestamp ?? point.time);
    return time >= start && time <= end;
  });
}

export function mergeTimePoints<T extends { timestamp?: unknown; time?: unknown }>(
  current: T[],
  incoming: T[],
  retentionSeconds = 360,
): T[] {
  const byTimestamp = new Map<number, T>();
  for (const point of [...current, ...incoming]) {
    const time = timestampMs(point.timestamp ?? point.time);
    if (time > 0) byTimestamp.set(time, { ...point, timestamp: time });
  }
  const sorted = Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
  const end = latestTimestamp(sorted);
  const start = end - Math.max(1, retentionSeconds) * 1000;
  return sorted.filter((point) => timestampMs(point.timestamp ?? point.time) >= start);
}

export function mergeFrozenTimePoints<T extends { timestamp?: unknown; time?: unknown }>(
  current: T[],
  incoming: T[],
  retentionSeconds = 360,
): T[] {
  const byTimestamp = new Map<number, T>();
  for (const point of incoming) {
    const time = timestampMs(point.timestamp ?? point.time);
    if (time > 0) byTimestamp.set(time, { ...point, timestamp: time });
  }
  for (const point of current) {
    const time = timestampMs(point.timestamp ?? point.time);
    if (time > 0) byTimestamp.set(time, point);
  }
  const sorted = Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
  const end = latestTimestamp(sorted);
  const start = end - Math.max(1, retentionSeconds) * 1000;
  return sorted.filter((point) => timestampMs(point.timestamp ?? point.time) >= start);
}
