/**
 * Content plate opacity is kept as integer percentages in the public API and
 * in local storage.  The rest of the UI works with this one small structure so
 * range/order validation cannot drift between startup, settings and previews.
 */
export type ContentPlateOpacity = {
  subtle: number;
  regular: number;
  strong: number;
};

export type ContentPlateOpacityKey = keyof ContentPlateOpacity;

export const CONTENT_PLATE_SETTINGS_STORAGE_KEY = "msf-content-plate-settings";
export const LEGACY_CONTENT_PLATE_OPACITY_STORAGE_KEY = "msf-content-plate-opacity";

export const DEFAULT_CONTENT_PLATE_OPACITY: ContentPlateOpacity = Object.freeze({
  subtle: 56,
  regular: 70,
  strong: 84,
});

export const CONTENT_PLATE_OPACITY_RANGES: Readonly<Record<ContentPlateOpacityKey, { min: number; max: number }>> = Object.freeze({
  subtle: Object.freeze({ min: 20, max: 80 }),
  regular: Object.freeze({ min: 30, max: 90 }),
  strong: Object.freeze({ min: 40, max: 96 }),
});

export const CONTENT_PLATE_OPACITY_API_KEYS: Readonly<Record<ContentPlateOpacityKey, string>> = Object.freeze({
  subtle: "content_plate_opacity_subtle",
  regular: "content_plate_opacity_regular",
  strong: "content_plate_opacity_strong",
});

export const CONTENT_PLATE_OPACITY_KEYS: readonly ContentPlateOpacityKey[] = ["subtle", "regular", "strong"];

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function parseIntegerPercentage(value: unknown): number | null {
  if (typeof value === "number") return isInteger(value) ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseLegacyInteger(value: unknown): number | null {
  if (typeof value === "number") return isInteger(value) ? value : null;
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Return true only for a complete, in-range and semantically ordered value. */
export function isValidContentPlateOpacity(value: unknown): value is ContentPlateOpacity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const values = CONTENT_PLATE_OPACITY_KEYS.map((key) => candidate[key]);
  if (!values.every(isInteger)) return false;

  for (const key of CONTENT_PLATE_OPACITY_KEYS) {
    const current = candidate[key] as number;
    const range = CONTENT_PLATE_OPACITY_RANGES[key];
    if (current < range.min || current > range.max) return false;
  }
  return (candidate.subtle as number) <= (candidate.regular as number)
    && (candidate.regular as number) <= (candidate.strong as number);
}

/** Parse the JSON shape stored under msf-content-plate-settings. */
export function parseStoredContentPlateOpacity(raw: string | null | undefined): ContentPlateOpacity | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseContentPlateOpacity(parsed);
  } catch {
    return null;
  }
}

/** Parse an internal numeric structure (used by storage and server adapters). */
export function parseContentPlateOpacity(value: unknown): ContentPlateOpacity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const parsed: ContentPlateOpacity = {
    subtle: parseIntegerPercentage(candidate.subtle) ?? Number.NaN,
    regular: parseIntegerPercentage(candidate.regular) ?? Number.NaN,
    strong: parseIntegerPercentage(candidate.strong) ?? Number.NaN,
  };
  return isValidContentPlateOpacity(parsed) ? parsed : null;
}

/**
 * Parse the API representation. API values are intentionally strings; accepting
 * numbers here would hide a server contract regression, so this adapter keeps
 * the boundary strict while still tolerating a wrapped `data` response.
 */
export function parseContentPlateOpacityApi(value: unknown): ContentPlateOpacity | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const data = source.data && typeof source.data === "object" ? source.data as Record<string, unknown> : source;
  const parsed: ContentPlateOpacity = {
    subtle: parseApiInteger(data[CONTENT_PLATE_OPACITY_API_KEYS.subtle]),
    regular: parseApiInteger(data[CONTENT_PLATE_OPACITY_API_KEYS.regular]),
    strong: parseApiInteger(data[CONTENT_PLATE_OPACITY_API_KEYS.strong]),
  };
  return isValidContentPlateOpacity(parsed) ? parsed : null;
}

function parseApiInteger(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return Number.NaN;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

/** Serialize a complete snapshot for the appearance API. */
export function serializeContentPlateOpacity(value: ContentPlateOpacity): Record<string, string> {
  if (!isValidContentPlateOpacity(value)) {
    throw new Error("Invalid content plate opacity snapshot");
  }
  return {
    [CONTENT_PLATE_OPACITY_API_KEYS.subtle]: String(value.subtle),
    [CONTENT_PLATE_OPACITY_API_KEYS.regular]: String(value.regular),
    [CONTENT_PLATE_OPACITY_API_KEYS.strong]: String(value.strong),
  };
}

/**
 * Migrate the legacy single value into the three semantic tiers. Each derived
 * value is clamped to its own range, preserving the old value as regular.
 */
export function migrateLegacyContentPlateOpacity(value: unknown): ContentPlateOpacity | null {
  const regular = parseLegacyInteger(value);
  if (regular === null) return null;
  const clamp = (candidate: number, key: ContentPlateOpacityKey) => {
    const range = CONTENT_PLATE_OPACITY_RANGES[key];
    return Math.min(range.max, Math.max(range.min, candidate));
  };
  const migrated = {
    subtle: clamp(regular - 14, "subtle"),
    regular: clamp(regular, "regular"),
    strong: clamp(regular + 14, "strong"),
  };
  return isValidContentPlateOpacity(migrated) ? migrated : null;
}

export function cloneContentPlateOpacity(value: ContentPlateOpacity): ContentPlateOpacity {
  return { subtle: value.subtle, regular: value.regular, strong: value.strong };
}

/** Clamp one editor field against its tier range and its neighboring tiers. */
export function updateContentPlateOpacity(
  value: ContentPlateOpacity,
  key: ContentPlateOpacityKey,
  nextValue: number,
): ContentPlateOpacity {
  const range = CONTENT_PLATE_OPACITY_RANGES[key];
  const next = Number.isFinite(nextValue)
    ? Math.min(range.max, Math.max(range.min, Math.round(nextValue)))
    : value[key];
  const updated = cloneContentPlateOpacity(value);
  if (key === "subtle") updated.subtle = Math.min(next, updated.regular);
  if (key === "regular") {
    updated.regular = Math.min(updated.strong, Math.max(updated.subtle, next));
  }
  if (key === "strong") updated.strong = Math.max(updated.regular, next);
  return updated;
}

/**
 * Move all three tiers from one overall slider. The regular tier is the
 * center value; subtle/strong keep the standard 14-point semantic distance
 * until an individual tier reaches its own supported range.
 */
export function updateOverallContentPlateOpacity(nextRegular: number): ContentPlateOpacity {
  const regularRange = CONTENT_PLATE_OPACITY_RANGES.regular;
  const regular = Number.isFinite(nextRegular)
    ? Math.min(regularRange.max, Math.max(regularRange.min, Math.round(nextRegular)))
    : DEFAULT_CONTENT_PLATE_OPACITY.regular;
  const clamp = (candidate: number, key: ContentPlateOpacityKey) => {
    const range = CONTENT_PLATE_OPACITY_RANGES[key];
    return Math.min(range.max, Math.max(range.min, candidate));
  };
  return {
    subtle: clamp(regular - 14, "subtle"),
    regular,
    strong: clamp(regular + 14, "strong"),
  };
}

/** Write only the three runtime variables; no glass/filter parameter is touched. */
export function applyContentPlateOpacityCss(value: ContentPlateOpacity, root?: HTMLElement): void {
  if (!isValidContentPlateOpacity(value)) return;
  const target = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;
  target.style.setProperty("--gary-plate-opacity-subtle", String(value.subtle / 100));
  target.style.setProperty("--gary-plate-opacity-regular", String(value.regular / 100));
  target.style.setProperty("--gary-plate-opacity-strong", String(value.strong / 100));
}

/**
 * Apply only one changed runtime variable.  Continuous slider previews use
 * this helper so an input event never rewrites all three CSS variables.
 */
export function applyContentPlateOpacityCssKey(
  value: ContentPlateOpacity,
  key: ContentPlateOpacityKey,
  root?: HTMLElement,
): void {
  if (!isValidContentPlateOpacity(value)) return;
  const target = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;
  target.style.setProperty(`--gary-plate-opacity-${key}`, String(value[key] / 100));
}
