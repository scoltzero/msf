import { timestampMs } from "./timeSeries";

export interface StableScaleState {
  ceiling: number;
  lowUpdates: number;
}

export function namedTimeValue(timestamp: unknown, value: unknown) {
  const time = timestampMs(timestamp) || Date.now();
  const numeric = Number(value || 0);
  return {
    name: String(time),
    value: [time, Number.isFinite(numeric) ? numeric : 0] as [number, number],
  };
}

export function delayedTimePoints<T>(points: T[]): T[] {
  return points.length > 1 ? points.slice(0, -1) : points;
}

function ladderCeiling(value: number, floor: number) {
  const target = Math.max(0, value, floor);
  if (target <= floor) return floor;
  const exponent = Math.floor(Math.log10(target));
  const magnitude = 10 ** exponent;
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= target) return Math.max(floor, candidate);
  }
  return Math.max(floor, target);
}

export function nextStableScale(
  previous: StableScaleState | undefined,
  observedMax: number,
  floor: number,
  lowerAfterUpdates = 30,
): StableScaleState {
  const target = ladderCeiling(observedMax * 1.08, floor);
  if (!previous) return { ceiling: target, lowUpdates: 0 };
  if (target > previous.ceiling) return { ceiling: target, lowUpdates: 0 };
  if (target === previous.ceiling) return { ceiling: previous.ceiling, lowUpdates: 0 };
  const lowUpdates = previous.lowUpdates + 1;
  if (lowUpdates < lowerAfterUpdates) return { ceiling: previous.ceiling, lowUpdates };
  return { ceiling: target, lowUpdates: 0 };
}
