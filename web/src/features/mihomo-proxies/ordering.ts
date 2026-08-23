/** Stable reconciliation between backend configuration order and local UI order. */

export function mergeStableOrder(configOrder: readonly string[], localOrder: readonly string[], validKeys?: Iterable<string>): string[] {
  const config = Array.from(new Set(configOrder.filter((key) => key.trim() !== "")));
  const valid = validKeys ? new Set(validKeys) : new Set(config);
  const configRank = new Map(config.map((key, index) => [key, index]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const key of localOrder) {
    if (!valid.has(key) || seen.has(key)) continue;
    result.push(key);
    seen.add(key);
  }
  const missing = config.filter((key) => !seen.has(key) && valid.has(key));
  for (const key of missing) {
    const rank = configRank.get(key) ?? Number.MAX_SAFE_INTEGER;
    const insertAt = result.findIndex((existing) => (configRank.get(existing) ?? Number.MAX_SAFE_INTEGER) > rank);
    if (insertAt < 0) result.push(key);
    else result.splice(insertAt, 0, key);
    seen.add(key);
  }
  return result;
}
export const reconcileProxyOrder = mergeStableOrder;

export function removeStaleOrderKeys(localOrder: readonly string[], validKeys: Iterable<string>): string[] {
  const valid = new Set(validKeys);
  return Array.from(new Set(localOrder.filter((key) => valid.has(key))));
}

export function orderIndex(order: readonly string[]): Map<string, number> {
  return new Map(order.map((key, index) => [key, index]));
}

export function sortByStableOrder<T>(items: readonly T[], getKey: (item: T) => string, order: readonly string[]): T[] {
  const rank = orderIndex(order);
  return items
    .map((item, index) => ({ item, index, rank: rank.get(getKey(item)) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
}
