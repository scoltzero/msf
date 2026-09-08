import { describe, expect, it } from "vitest";

import {
  accentCSS,
  chartTripletsFromAccent,
  isValidAccentColor,
  readableAccentForeground,
  shiftHue,
} from "./accent";
import { parseSkinTint } from "./skinTint";

describe("shiftHue", () => {
  it("rotates pure hues exactly", () => {
    expect(shiftHue("#ff0000", 120)).toBe("#00ff00");
    expect(shiftHue("#ff0000", 240)).toBe("#0000ff");
    expect(shiftHue("#00ff00", 360)).toBe("#00ff00");
  });

  it("returns valid hex for arbitrary colors", () => {
    expect(shiftHue("#f97316", 45)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shiftHue("#f97316", 45)).not.toBe("#f97316");
  });
});

describe("readableAccentForeground", () => {
  it("picks dark text on light accents and white on dark accents", () => {
    expect(readableAccentForeground("#ffffff")).toBe("#1c1917");
    expect(readableAccentForeground("#fef3c7")).toBe("#1c1917");
    expect(readableAccentForeground("#000000")).toBe("#ffffff");
    expect(readableAccentForeground("#1d4ed8")).toBe("#ffffff");
  });
});

describe("chartTripletsFromAccent", () => {
  it("uses the accent for download and derives four distinct hues", () => {
    const triplets = chartTripletsFromAccent("#f97316");
    expect(triplets.download).toBe("249, 115, 22");
    const values = Object.values(triplets);
    expect(new Set(values).size).toBe(5);
    for (const value of values) expect(value).toMatch(/^\d+, \d+, \d+$/);
  });
});

describe("accentCSS", () => {
  it("overrides brand variables, charts, atmosphere light and selection", () => {
    const css = accentCSS("#f97316");
    expect(css).toContain("--primary: #f97316;");
    expect(css).toContain("--msf-chart-download: 249, 115, 22;");
    expect(css).toContain("--gary-scene-a: color-mix(in srgb, #f97316 22%, transparent);");
    expect(css).toContain("::selection");
    expect(css).toContain("html[data-skin].dark");
  });
});

describe("isValidAccentColor", () => {
  it("accepts only #rrggbb", () => {
    expect(isValidAccentColor("#F97316")).toBe(true);
    expect(isValidAccentColor(" #f97316 ")).toBe(true);
    expect(isValidAccentColor("red")).toBe(false);
    expect(isValidAccentColor("#12345")).toBe(false);
    expect(isValidAccentColor(123)).toBe(false);
  });
});

describe("parseSkinTint", () => {
  it("parses degrees within 0-360 and rejects anything else", () => {
    expect(parseSkinTint("")).toBeNull();
    expect(parseSkinTint("0")).toBe(0);
    expect(parseSkinTint("120")).toBe(120);
    expect(parseSkinTint("360")).toBe(360);
    expect(parseSkinTint("361")).toBeNull();
    expect(parseSkinTint("-5")).toBeNull();
    expect(parseSkinTint("abc")).toBeNull();
    expect(parseSkinTint(120)).toBeNull();
    expect(parseSkinTint(" 90 ")).toBe(90);
  });
});
