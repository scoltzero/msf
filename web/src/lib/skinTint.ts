/**
 * Atmosphere tint: rotates the hue of the background stage (.gary-scene) so
 * the ambient lights, WebGL waves and everything seen through the glass shift
 * together. Content (text, charts) sits above the stage and is untouched.
 *
 * Value: degrees 0-360, or empty/null = follow the skin default.
 */
export const SKIN_TINT_STORAGE_KEY = "msf-skin-tint";
export const SKIN_TINT_STYLE_ID = "msf-skin-tint-css";

const SKIN_TINT_PATTERN = /^\d{1,3}$/;

/** Return the tint degrees for a stored/API value, or null when unset/invalid. */
export function parseSkinTint(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!SKIN_TINT_PATTERN.test(trimmed)) return null;
  const degrees = Number(trimmed);
  return Number.isInteger(degrees) && degrees >= 0 && degrees <= 360 ? degrees : null;
}

export function applySkinTint(degrees: number | null) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(SKIN_TINT_STYLE_ID);
  if (degrees === null) {
    existing?.remove();
    window.localStorage.removeItem(SKIN_TINT_STORAGE_KEY);
    return;
  }
  let style = existing as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = SKIN_TINT_STYLE_ID;
    const custom = document.getElementById("msf-custom-css");
    if (custom && custom.parentNode) custom.parentNode.insertBefore(style, custom);
    else document.head.appendChild(style);
  }
  const css = `html .gary-scene { filter: hue-rotate(${degrees}deg); }`;
  if (style.textContent !== css) style.textContent = css;
  window.localStorage.setItem(SKIN_TINT_STORAGE_KEY, String(degrees));
}

/** Restore the cached tint before React mounts so the first paint matches. */
export function restoreCachedSkinTint() {
  if (typeof window === "undefined") return;
  const cached = parseSkinTint(window.localStorage.getItem(SKIN_TINT_STORAGE_KEY));
  if (cached !== null) applySkinTint(cached);
}
