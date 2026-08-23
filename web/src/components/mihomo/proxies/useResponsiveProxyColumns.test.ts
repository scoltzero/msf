import { describe, expect, it } from "vitest";
import {
  PROXY_NODE_DIALOG_MAX_WIDTH,
  PROXY_TWO_COLUMN_MIN_WIDTH,
  shouldUseProxyColumns,
  shouldUseProxyNodeDialog,
  splitProxyItems,
} from "./useResponsiveProxyColumns";

describe("responsive proxy columns", () => {
  it("splits the original order into even and odd columns", () => {
    expect(splitProxyItems(["a", "b", "c", "d", "e"], true)).toEqual([["a", "c", "e"], ["b", "d"]]);
    expect(splitProxyItems(["a", "b", "c"], false)).toEqual([["a", "b", "c"], []]);
  });

  it("uses the content-width threshold instead of a viewport breakpoint", () => {
    expect(shouldUseProxyColumns(PROXY_TWO_COLUMN_MIN_WIDTH - 1)).toBe(false);
    expect(shouldUseProxyColumns(PROXY_TWO_COLUMN_MIN_WIDTH)).toBe(true);
    expect(shouldUseProxyColumns(PROXY_TWO_COLUMN_MIN_WIDTH, false)).toBe(false);
  });

  it("uses the node layer through the compact content width", () => {
    expect(shouldUseProxyNodeDialog(PROXY_NODE_DIALOG_MAX_WIDTH)).toBe(true);
    expect(shouldUseProxyNodeDialog(PROXY_NODE_DIALOG_MAX_WIDTH + 1)).toBe(false);
    expect(shouldUseProxyNodeDialog(0)).toBe(false);
  });
});
