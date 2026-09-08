/**
 * Brand accent color: a single hex that overrides the primary/ring/highlight
 * variables on top of the active skin — and, because a visible accent must
 * reach the whole panel, it also derives the five chart series colors, tints
 * the primary atmosphere light and the text selection color. It is applied
 * through a dedicated <style> element inserted BEFORE the custom CSS element,
 * so hand-written custom CSS still wins as the final escape hatch.
 *
 * Empty string means "follow the skin default" (no override at all).
 */
export const ACCENT_STORAGE_KEY = "msf-accent-color";
export const ACCENT_STYLE_ID = "msf-accent-css";

const ACCENT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const accentPresets = [
  "#f97316",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#7c3aed",
  "#e11d48",
  "#d97706",
  "#475569",
] as const;

export function isValidAccentColor(value: unknown): value is string {
  return typeof value === "string" && ACCENT_COLOR_PATTERN.test(value.trim());
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** Rotate the hue of a #rrggbb color and optionally shift lightness/saturation. */
export function shiftHue(hex: string, degrees: number, lightnessDelta = 0, saturationDelta = 0): string {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  h = (h + degrees / 360 + 1) % 1;
  s = Math.max(0, Math.min(1, s + saturationDelta));
  l = Math.max(0.08, Math.min(0.92, l + lightnessDelta));
  const [nr, ng, nb] = hslToRgb(h, s, l);
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

export type AccentChartSeries = "cpu" | "memory" | "download" | "upload" | "connections";

/**
 * Derive five distinguishable chart colors from one accent hue so dashboards
 * visibly follow the picker. Offsets: download=base, upload=+45°, cpu=-140°,
 * memory=+140°, connections=+95° (well separated on the wheel).
 */
export function chartTripletsFromAccent(hex: string): Record<AccentChartSeries, string> {
  const asTriplet = (color: string) => hexToRgb(color).join(", ");
  return {
    download: asTriplet(hex),
    upload: asTriplet(shiftHue(hex, 45, 0.04)),
    cpu: asTriplet(shiftHue(hex, -140, 0.02)),
    memory: asTriplet(shiftHue(hex, 140, -0.04)),
    connections: asTriplet(shiftHue(hex, 95, -0.06)),
  };
}

function linearChannel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** Pick a readable button label color for the given accent background. */
export function readableAccentForeground(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
  return luminance > 0.45 ? "#1c1917" : "#ffffff";
}

export function accentCSS(hex: string): string {
  const normalized = hex.trim().toLowerCase();
  const foreground = readableAccentForeground(normalized);
  const charts = chartTripletsFromAccent(normalized);
  const [r, g, b] = hexToRgb(normalized);
  return [
    `:root, html[data-skin], html.dark, html[data-skin].dark {`,
    `  --primary: ${normalized};`,
    `  --ring: ${normalized};`,
    `  --primary-foreground: ${foreground};`,
    `  --sidebar-primary: ${normalized};`,
    `  --sidebar-ring: ${normalized};`,
    `  --accent: color-mix(in srgb, ${normalized} 14%, transparent);`,
    `  --accent-foreground: ${foreground};`,
    `  /* Atmosphere light A follows the accent so the scene visibly shifts. */`,
    `  --gary-scene-a: color-mix(in srgb, ${normalized} 22%, transparent);`,
    `  /* Charts derive five separated hues from the accent. */`,
    `  --msf-chart-cpu: ${charts.cpu};`,
    `  --msf-chart-memory: ${charts.memory};`,
    `  --msf-chart-download: ${charts.download};`,
    `  --msf-chart-upload: ${charts.upload};`,
    `  --msf-chart-connections: ${charts.connections};`,
    `}`,
    `::selection {`,
    `  background: rgba(${r}, ${g}, ${b}, 0.35);`,
    `}`,
  ].join("\n");
}

function ensureAccentStyle(): HTMLStyleElement {
  let style = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = ACCENT_STYLE_ID;
    const custom = document.getElementById("msf-custom-css");
    if (custom && custom.parentNode) custom.parentNode.insertBefore(style, custom);
    else document.head.appendChild(style);
  }
  return style;
}

export function applyAccentColor(hex: string) {
  if (typeof document === "undefined") return;
  const value = typeof hex === "string" ? hex.trim().toLowerCase() : "";
  const style = document.getElementById(ACCENT_STYLE_ID);
  if (!isValidAccentColor(value)) {
    style?.remove();
    if (value === "") window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    return;
  }
  const target = ensureAccentStyle();
  const css = accentCSS(value);
  if (target.textContent !== css) target.textContent = css;
  window.localStorage.setItem(ACCENT_STORAGE_KEY, value);
}

/** Restore the cached accent before React mounts so the first paint matches. */
export function restoreCachedAccentColor() {
  if (typeof window === "undefined") return;
  const cached = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  if (isValidAccentColor(cached)) applyAccentColor(cached);
}
