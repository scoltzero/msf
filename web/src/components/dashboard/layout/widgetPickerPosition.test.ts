import { describe, expect, it } from "vitest";
import { clampWidgetPickerPosition } from "./widgetPickerPosition";

describe("clampWidgetPickerPosition", () => {
  const bounds = { viewportWidth: 1280, viewportHeight: 800, panelWidth: 440, panelHeight: 620, margin: 12 };

  it("keeps a visible position unchanged", () => {
    expect(clampWidgetPickerPosition({ x: 500, y: 100 }, bounds)).toEqual({ x: 500, y: 100 });
  });

  it("keeps the panel inside every viewport edge", () => {
    expect(clampWidgetPickerPosition({ x: -50, y: -80 }, bounds)).toEqual({ x: 12, y: 12 });
    expect(clampWidgetPickerPosition({ x: 1200, y: 700 }, bounds)).toEqual({ x: 828, y: 168 });
  });

  it("uses the safe margin when the panel is larger than the viewport", () => {
    expect(clampWidgetPickerPosition({ x: 100, y: 100 }, {
      viewportWidth: 390,
      viewportHeight: 500,
      panelWidth: 440,
      panelHeight: 620,
    })).toEqual({ x: 12, y: 12 });
  });
});
