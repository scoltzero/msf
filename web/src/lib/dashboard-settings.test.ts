import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CORRUPT_BACKUP_PREFIX,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_SETTINGS_STORAGE_KEY,
  LEGACY_DASHBOARD_SETTINGS_STORAGE_KEY,
  V2_DASHBOARD_SETTINGS_STORAGE_KEY,
  createDefaultDashboardSettings,
  loadDashboardSettingsFromStorage,
  normalizeDashboardSettings,
} from "./dashboard-settings";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("dashboard settings v3", () => {
  it("migrates V1 and restores the original independent info cards", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DASHBOARD_SETTINGS_STORAGE_KEY, JSON.stringify({ compact: true, visible: { device: false, hardware: true, stats: true, rate: false } }));
    const result = loadDashboardSettingsFromStorage(storage);
    expect(result.version).toBe(3);
    expect(result.compact).toBe(true);
    expect(result.instances.some((item) => item.type === "system-device")).toBe(false);
    expect(result.instances.some((item) => item.type === "system-hardware")).toBe(true);
    expect(result.instances.some((item) => item.type === "system-stats")).toBe(true);
    expect(result.instances.some((item) => item.type === "system-rate")).toBe(false);
    expect(storage.getItem(DASHBOARD_SETTINGS_STORAGE_KEY)).not.toBeNull();
  });

  it("backs up malformed JSON and returns defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem(DASHBOARD_SETTINGS_STORAGE_KEY, "{broken");
    const result = loadDashboardSettingsFromStorage(storage);
    expect(result.instances.length).toBeGreaterThan(0);
    expect([...storage.values.keys()].some((key) => key.startsWith(DASHBOARD_CORRUPT_BACKUP_PREFIX))).toBe(true);
  });

  it("deduplicates, clamps layout bounds and enforces fifteen instances", () => {
    const instances = Array.from({ length: 18 }, (_, index) => ({ id: `proxy-${index}`, type: "mihomo-proxy-group" }));
    const result = normalizeDashboardSettings({ version: 3, compact: false, instances, layouts: { desktop: [{ i: "proxy-0", x: 20, y: -1, w: 30, h: 1 }], tablet: [], mobile: [] } });
    expect(result?.instances).toHaveLength(DASHBOARD_MAX_WIDGETS);
    expect(result?.layouts.desktop[0]).toMatchObject({ x: 0, y: 0, w: 12, h: 2 });
  });

  it("migrates V2 collections, removes Sing-Box and keeps their layouts", () => {
    const storage = new MemoryStorage();
    storage.setItem(V2_DASHBOARD_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 2,
      compact: false,
      instances: [
        { id: "info", type: "system-info", settings: { tab: "hardware" } },
        { id: "info", type: "system-info", settings: { tab: "stats" } },
        { id: "cache", type: "mosdns-cache-stats", settings: { activePage: "foreign" } },
        { id: "sing", type: "singbox-service" },
      ],
      layouts: {
        desktop: [{ i: "info", x: 2, y: 1, w: 6, h: 7 }, { i: "cache", x: 8, y: 1, w: 4, h: 7 }, { i: "sing", x: 0, y: 8, w: 4, h: 5 }],
        tablet: [],
        mobile: [],
      },
    }));
    const result = loadDashboardSettingsFromStorage(storage);
    expect(result.version).toBe(3);
    expect(result.instances.some((item) => item.id === "sing")).toBe(false);
    expect(result.instances.filter((item) => item.id === "info")).toHaveLength(1);
    expect(result.instances.find((item) => item.id === "info")?.settings).toMatchObject({ pages: ["device", "hardware", "stats"], activePage: "hardware" });
    expect(result.instances.find((item) => item.id === "cache")?.settings).toMatchObject({ pages: ["all", "domestic", "foreign", "node"], activePage: "foreign" });
    expect(result.layouts.desktop.find((item) => item.i === "info")).toMatchObject({ x: 2, y: 1, w: 6, h: 7 });
  });

  it("sanitizes every split/merged collection and preserves the original default homepage", () => {
    const normalized = normalizeDashboardSettings({
      version: 3,
      compact: false,
      instances: [
        { id: "info", type: "system-info", settings: { pages: ["unknown"], activePage: "unknown" } },
        { id: "mosdns", type: "mosdns-info", settings: { pages: ["clients", "clients", "unknown"], activePage: "split" } },
        { id: "cache", type: "mosdns-cache-stats", settings: { pages: [], activePage: "node" } },
      ],
      layouts: { desktop: [], tablet: [], mobile: [] },
    });
    expect(normalized?.instances.find((item) => item.id === "info")?.settings).toMatchObject({ pages: ["device"], activePage: "device" });
    expect(normalized?.instances.find((item) => item.id === "mosdns")?.settings).toMatchObject({ pages: ["clients"], activePage: "clients" });
    expect(normalized?.instances.find((item) => item.id === "cache")?.settings).toMatchObject({ pages: ["all"], activePage: "all" });
    expect(createDefaultDashboardSettings().instances.map((item) => item.type)).toEqual([
      "system-device", "system-hardware", "system-resources", "system-rate", "system-stats", "mosdns-service", "mihomo-service",
    ]);
  });
});
