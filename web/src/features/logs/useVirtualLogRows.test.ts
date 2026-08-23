import { describe, expect, it } from "vitest";
import { calculateVirtualLogRange } from "./useVirtualLogRows";

describe("calculateVirtualLogRange", () => {
  it("mounts only the visible log rows plus overscan", () => {
    expect(calculateVirtualLogRange(1000, 4800, 480, 24, 10)).toEqual({
      start: 190,
      end: 230,
    });
  });

  it("clamps the range at the beginning and end", () => {
    expect(calculateVirtualLogRange(12, 0, 240, 24, 10)).toEqual({ start: 0, end: 12 });
    expect(calculateVirtualLogRange(100, 2300, 240, 24, 10)).toEqual({ start: 85, end: 100 });
  });
});
