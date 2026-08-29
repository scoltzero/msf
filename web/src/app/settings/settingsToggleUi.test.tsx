import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Settings toggle visual state", () => {
  const source = readFileSync(new URL("./SettingsClient.tsx", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../../styles/liquid-glass-controls.css", import.meta.url), "utf8");
  const pages = readFileSync(new URL("../../styles/liquid-glass-pages.css", import.meta.url), "utf8");

  it("uses a stable toggle class with a blue pressed track", () => {
    expect(source).toContain("gary-toggle inline-flex");
    expect(controls).toContain('.gary-toggle[aria-pressed="true"]');
    expect(controls).toContain("background-color: var(--primary)");
    expect(controls).toContain("border-color: var(--primary)");
  });

  it("excludes toggles from the generic glass button background override", () => {
    expect(pages).toContain(":not(.gary-toggle)");
  });
});
