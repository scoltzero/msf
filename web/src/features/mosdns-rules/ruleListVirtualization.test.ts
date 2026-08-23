import { describe, expect, it } from "vitest";
import { autoScrollVelocity, calculateVirtualRange, indexFromPointer, reorderByKey } from "./ruleListVirtualization";

describe("MosDNS personalized rule list virtualization", () => {
  it("mounts only the visible window plus overscan", () => {
    expect(calculateVirtualRange({
      count: 140,
      rowHeight: 49,
      listTop: 500,
      scrollY: 1000,
      viewportHeight: 900,
      overscan: 10,
    })).toEqual({ start: 0, end: 39 });
  });

  it("keeps the range inside the complete list near the bottom", () => {
    expect(calculateVirtualRange({
      count: 140,
      rowHeight: 49,
      listTop: 500,
      scrollY: 7000,
      viewportHeight: 900,
      overscan: 10,
    })).toEqual({ start: 122, end: 140 });
  });

  it("maps a pointer to a bounded rule index", () => {
    expect(indexFromPointer(245, 0, 49, 140)).toBe(5);
    expect(indexFromPointer(-20, 0, 49, 140)).toBe(0);
    expect(indexFromPointer(9000, 0, 49, 140)).toBe(139);
  });

  it("accelerates page scrolling only near viewport edges", () => {
    expect(autoScrollVelocity(400, 800)).toBe(0);
    expect(autoScrollVelocity(0, 800)).toBe(-22);
    expect(autoScrollVelocity(800, 800)).toBe(22);
    expect(autoScrollVelocity(48, 800)).toBe(-11);
  });

  it("reorders the full data set by stable keys", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    expect(reorderByKey(items, "a", "c", (item) => item.key).map((item) => item.key)).toEqual(["b", "c", "a", "d"]);
    expect(reorderByKey(items, "missing", "c", (item) => item.key)).toBe(items);
  });
});
