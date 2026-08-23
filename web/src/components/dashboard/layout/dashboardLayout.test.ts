import { describe, expect, it } from "vitest";
import { createDefaultDashboardSettings } from "@/lib/dashboard-settings";
import { addDashboardWidget, buildDefaultLayout, closestAllowedWidth, packDashboardLayout, removeDashboardWidget, snapDashboardItem } from "./dashboardLayout";

describe("dashboard layout", () => {
  it("snaps desktop widths to the four registered sizes", () => {
    expect(closestAllowedWidth(5, [3, 4, 6, 12])).toBe(4);
    const cache = { id: "cache", type: "mosdns-cache-stats" as const };
    expect(snapDashboardItem({ i: "cache", x: 11, y: -2, w: 3, h: 1 }, cache, "desktop")).toEqual({ i: "cache", x: 9, y: 0, w: 3, h: 5 });
  });

  it("keeps the half-width default rate and stats pair", () => {
    const settings = createDefaultDashboardSettings();
    expect(settings.layouts.desktop.find((item) => item.i === "system-rate")).toMatchObject({ x: 0, y: 5, w: 6, h: 5 });
    expect(settings.layouts.desktop.find((item) => item.i === "system-stats")).toMatchObject({ x: 6, y: 5, w: 6, h: 5 });
    expect(settings.layouts.desktop.find((item) => item.i === "mosdns-service")).toMatchObject({ y: 10 });
  });

  it("never grants XS to widgets whose registry minimum is S", () => {
    const info = { id: "info", type: "system-info" as const };
    expect(snapDashboardItem({ i: "info", x: 0, y: 0, w: 3, h: 5 }, info, "desktop").w).toBe(4);
  });

  it("uses one column on mobile and adds/removes instances atomically", () => {
    const settings = createDefaultDashboardSettings();
    const added = addDashboardWidget(settings, "mihomo-proxy-group");
    expect(added?.instances).toHaveLength(settings.instances.length + 1);
    expect(added?.layouts.mobile.at(-1)?.w).toBe(1);
    const id = added!.instances.at(-1)!.id;
    expect(removeDashboardWidget(added!, id).layouts.desktop.some((item) => item.i === id)).toBe(false);
    expect(buildDefaultLayout(settings.instances, "mobile").every((item) => item.x === 0 && item.w === 1)).toBe(true);
  });

  it("counts every multi-instance widget toward the fifteen item cap", () => {
    let settings = createDefaultDashboardSettings();
    while (settings.instances.length < 15) settings = addDashboardWidget(settings, "mihomo-proxy-group")!;
    expect(settings.instances).toHaveLength(15);
    expect(addDashboardWidget(settings, "mihomo-proxy-group")).toBeNull();
  });

  it("packs four XS widgets into one desktop row", () => {
    const packed = packDashboardLayout(Array.from({ length: 4 }, (_, index) => ({ i: `xs-${index}`, x: 0, y: 0, w: 3, h: 4 })), 12);
    expect(packed.map(({ x, y }) => [x, y])).toEqual([[0, 0], [3, 0], [6, 0], [9, 0]]);
  });

  it("packs three S widgets into one desktop row", () => {
    const packed = packDashboardLayout(Array.from({ length: 3 }, (_, index) => ({ i: `s-${index}`, x: 0, y: 0, w: 4, h: 4 })), 12);
    expect(packed.map(({ x, y }) => [x, y])).toEqual([[0, 0], [4, 0], [8, 0]]);
  });

  it("packs two M widgets into one desktop row", () => {
    const packed = packDashboardLayout(Array.from({ length: 2 }, (_, index) => ({ i: `m-${index}`, x: 0, y: 0, w: 6, h: 5 })), 12);
    expect(packed.map(({ x, y }) => [x, y])).toEqual([[0, 0], [6, 0]]);
  });

  it("fills the first mixed-size hole before starting a new row", () => {
    const packed = packDashboardLayout([
      { i: "m", x: 0, y: 0, w: 6, h: 5 },
      { i: "xs-1", x: 0, y: 0, w: 3, h: 4 },
      { i: "xs-2", x: 0, y: 0, w: 3, h: 4 },
      { i: "s", x: 0, y: 0, w: 4, h: 4 },
      { i: "m-2", x: 0, y: 0, w: 6, h: 5 },
    ], 12);
    expect(packed.map(({ x, y }) => [x, y])).toEqual([[0, 0], [6, 0], [9, 0], [6, 4], [0, 5]]);
  });

  it("fills vertical space below a short card before the tallest column ends", () => {
    const packed = packDashboardLayout([
      { i: "tall", x: 0, y: 0, w: 6, h: 10 },
      { i: "short", x: 0, y: 0, w: 6, h: 4 },
      { i: "fill", x: 0, y: 0, w: 6, h: 5 },
    ], 12);
    expect(packed.map(({ x, y }) => [x, y])).toEqual([[0, 0], [6, 0], [6, 4]]);
  });

  it("adds a widget into an existing row gap without moving customized items", () => {
    const settings = createDefaultDashboardSettings();
    settings.instances = [{ id: "left", type: "system-device" }, { id: "right", type: "mihomo-service" }];
    settings.layouts.desktop = [
      { i: "left", x: 0, y: 0, w: 4, h: 5 },
      { i: "right", x: 8, y: 0, w: 4, h: 5 },
    ];
    settings.layouts.tablet = [];
    settings.layouts.mobile = [];
    const added = addDashboardWidget(settings, "mosdns-service")!;
    expect(added.layouts.desktop).toEqual([
      ...settings.layouts.desktop,
      { i: "mosdns-service", x: 4, y: 0, w: 4, h: 5 },
    ]);
  });
});
