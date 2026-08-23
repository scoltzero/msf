export type VirtualRange = {
  start: number;
  end: number;
};

type VirtualRangeOptions = {
  count: number;
  rowHeight: number;
  listTop: number;
  scrollY: number;
  viewportHeight: number;
  overscan: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateVirtualRange({
  count,
  rowHeight,
  listTop,
  scrollY,
  viewportHeight,
  overscan,
}: VirtualRangeOptions): VirtualRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };

  const firstVisible = Math.floor((scrollY - listTop) / rowHeight);
  const lastVisible = Math.ceil((scrollY + viewportHeight - listTop) / rowHeight);
  const start = clamp(firstVisible - overscan, 0, count);
  const end = clamp(lastVisible + overscan, start, count);

  return { start, end };
}

export function indexFromPointer(pointerY: number, listTopInViewport: number, rowHeight: number, count: number) {
  if (count <= 0 || rowHeight <= 0) return -1;
  return clamp(Math.floor((pointerY - listTopInViewport) / rowHeight), 0, count - 1);
}

export function autoScrollVelocity(pointerY: number, viewportHeight: number, edgeSize = 96, maximumSpeed = 22) {
  if (viewportHeight <= 0 || edgeSize <= 0 || maximumSpeed <= 0) return 0;
  if (pointerY < edgeSize) {
    return -maximumSpeed * clamp((edgeSize - pointerY) / edgeSize, 0, 1);
  }
  if (pointerY > viewportHeight - edgeSize) {
    return maximumSpeed * clamp((pointerY - (viewportHeight - edgeSize)) / edgeSize, 0, 1);
  }
  return 0;
}

export function reorderByKey<T>(items: T[], sourceKey: string, targetKey: string, keyForItem: (item: T, index: number) => string) {
  const sourceIndex = items.findIndex((item, index) => keyForItem(item, index) === sourceKey);
  const targetIndex = items.findIndex((item, index) => keyForItem(item, index) === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;

  const reordered = [...items];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}
