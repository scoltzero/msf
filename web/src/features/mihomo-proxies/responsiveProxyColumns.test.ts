import { describe, expect, it } from "vitest";
import {
  PROXY_NODE_DIALOG_MAX_WIDTH,
  PROXY_TWO_COLUMN_MIN_WIDTH,
  shouldUseProxyColumns,
  shouldUseProxyNodeDialog,
  splitProxyItems,
} from "../../components/mihomo/proxies/useResponsiveProxyColumns";

describe("responsive proxy group layout", () => {
  it("switches to two columns at 600px only when enabled", () => {
    expect(shouldUseProxyColumns(PROXY_TWO_COLUMN_MIN_WIDTH - 1)).toBe(false);
    expect(shouldUseProxyColumns(PROXY_TWO_COLUMN_MIN_WIDTH)).toBe(true);

    expect(shouldUseProxyColumns(0, false)).toBe(false);
    expect(shouldUseProxyColumns(599, false)).toBe(false);
    expect(shouldUseProxyColumns(600, false)).toBe(false);
    expect(shouldUseProxyColumns(1440, false)).toBe(false);
  });

  it("uses the node dialog through 768px and stays closed for the initial width", () => {
    expect(shouldUseProxyNodeDialog(600)).toBe(true);
    expect(shouldUseProxyNodeDialog(PROXY_NODE_DIALOG_MAX_WIDTH)).toBe(true);
    expect(shouldUseProxyNodeDialog(PROXY_NODE_DIALOG_MAX_WIDTH + 1)).toBe(false);
    expect(shouldUseProxyNodeDialog(0)).toBe(false);
  });

  it("keeps parity columns paired in configuration order and restores one-column order", () => {
    const items = ["group-a", "group-b", "group-c", "group-d", "group-e"];

    expect(splitProxyItems(items, true)).toEqual([
      ["group-a", "group-c", "group-e"],
      ["group-b", "group-d"],
    ]);
    expect(splitProxyItems(items, false)).toEqual([items, []]);
  });

  it("does not drop or duplicate empty or odd-length item arrays", () => {
    expect(splitProxyItems([], true)).toEqual([[], []]);

    const items = ["a", "b", "c", "d", "e"];
    const [left, right] = splitProxyItems(items, true);
    const allItems = [...left, ...right];

    expect(allItems).toHaveLength(items.length);
    expect(new Set(allItems)).toEqual(new Set(items));
    expect(new Set(allItems).size).toBe(allItems.length);
  });
});
