/**
 * Skin is the palette/material identity of the panel (amber | classic) and is
 * orthogonal to light/dark mode. The choice is cached in localStorage for a
 * stable first paint and persisted server-side via /api/v1/settings/appearance
 * so it survives auth expiry and device changes.
 */
export type SkinId = "amber" | "classic";

export const SKIN_STORAGE_KEY = "msf-skin";
export const CUSTOM_CSS_STORAGE_KEY = "msf-custom-css";
export const CUSTOM_CSS_STYLE_ID = "msf-custom-css";
export const DEFAULT_SKIN: SkinId = "classic";

export const skinOptions: Array<{ id: SkinId; label: string; description: string }> = [
  {
    id: "amber",
    label: "琥珀暖白",
    description: "暖白玻璃拟态：暖白底、米色描边、橙色品牌色与三层氛围光。",
  },
  {
    id: "classic",
    label: "经典玻璃",
    description: "msf 原生液态玻璃：冷白底、蓝色品牌色与石墨动态场景。",
  },
];

export function isSkinId(value: unknown): value is SkinId {
  return value === "amber" || value === "classic";
}

export function getInitialSkin(): SkinId {
  if (typeof window === "undefined") return DEFAULT_SKIN;
  const stored = window.localStorage.getItem(SKIN_STORAGE_KEY);
  return isSkinId(stored) ? stored : DEFAULT_SKIN;
}

export function applySkin(skin: SkinId) {
  if (typeof window === "undefined") return;
  document.documentElement.dataset.skin = skin;
  window.localStorage.setItem(SKIN_STORAGE_KEY, skin);
}

export function applyCustomCSS(css: string) {
  if (typeof document === "undefined") return;
  const text = typeof css === "string" ? css : "";
  let style = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!text.trim()) {
    style?.remove();
    window.localStorage.removeItem(CUSTOM_CSS_STORAGE_KEY);
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== text) style.textContent = text;
  window.localStorage.setItem(CUSTOM_CSS_STORAGE_KEY, text);
}

/** Restore the cached custom CSS before React mounts so overrides apply on first paint. */
export function restoreCachedCustomCSS() {
  if (typeof window === "undefined") return;
  const cached = window.localStorage.getItem(CUSTOM_CSS_STORAGE_KEY);
  if (cached && cached.trim()) applyCustomCSS(cached);
}
