import { describe, expect, it } from "vitest";
import {
  COLLAPSE_PREFIX_V1,
  COLLAPSE_PREFIX_V2,
  PROXY_TAB_KEY,
  PROXY_TAB_KEY_V2,
  migrateProxyCollapseStorage,
  readCollapsed,
  readProxyTab,
  type StorageLike,
} from "./useProxyDisclosure";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("proxy disclosure persistence", () => {
  it("defaults newly discovered groups and providers to collapsed", () => {
    const storage = new MemoryStorage();
    expect(readCollapsed("group", "global:节点选择", storage)).toBe(true);
    expect(readCollapsed("provider", "airport", storage)).toBe(true);
  });

  it("migrates legacy per-item collapse values to the v2 namespace", () => {
    const storage = new MemoryStorage();
    storage.setItem(`${COLLAPSE_PREFIX_V1}.group.foo`, "0");
    storage.setItem(`${COLLAPSE_PREFIX_V1}.provider.airport`, "1");

    migrateProxyCollapseStorage({ group: ["foo"], provider: ["airport"] }, storage);

    expect(storage.getItem(`${COLLAPSE_PREFIX_V2}.group.foo`)).toBe("0");
    expect(storage.getItem(`${COLLAPSE_PREFIX_V2}.provider.airport`)).toBe("1");
    expect(storage.getItem(`${COLLAPSE_PREFIX_V1}.group.foo`)).toBeNull();
    expect(readCollapsed("group", "foo", storage)).toBe(false);
    expect(readCollapsed("provider", "airport", storage)).toBe(true);
  });

  it("keeps a previously persisted tab and repairs the v2 tab key", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROXY_TAB_KEY, "providers");
    expect(readProxyTab(storage)).toBe("providers");
    expect(storage.getItem(PROXY_TAB_KEY_V2)).toBe("providers");

    storage.setItem(PROXY_TAB_KEY_V2, "groups");
    expect(readProxyTab(storage)).toBe("groups");
  });
});
