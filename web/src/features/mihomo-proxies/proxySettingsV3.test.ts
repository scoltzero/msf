import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  PROXY_SETTINGS_KEY_V2,
  PROXY_SETTINGS_VERSION,
  migrateProxySettings,
  normalizeProxySettings,
  readProxySettings,
  resetProxySettings,
  writeProxySettings,
} from "./settings";

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("proxy settings v3 defaults", () => {
  it("matches the Zashboard-oriented default appearance contract", () => {
    expect(DEFAULT_PROXY_SETTINGS).toMatchObject({
      version: 3,
      displayGlobalByMode: true,
      doubleColumn: true,
      proxyPreviewType: "auto",
      proxyGroupIconSize: 24,
      proxyGroupIconMargin: 12,
      minProxyCardWidth: 145,
      disableProxiesPageTextSelect: true,
    });
    expect(PROXY_SETTINGS_VERSION).toBe(3);
  });

  it("returns fresh array defaults for every read/reset/write result", () => {
    const first = readProxySettings(undefined);
    const second = readProxySettings(undefined);
    const reset = resetProxySettings(undefined);
    const written = writeProxySettings({}, undefined);

    expect(first.version).toBe(3);
    expect(reset.version).toBe(3);
    expect(written.version).toBe(3);
    expect(first.groupOrder).not.toBe(second.groupOrder);
    expect(first.hiddenGroups).not.toBe(second.hiddenGroups);
    expect(first.groupOrder).not.toBe(reset.groupOrder);
    expect(reset.hiddenGroups).not.toBe(written.hiddenGroups);
  });
});

describe("proxy settings v2 to v3 migration", () => {
  it("preserves legacy group order, hidden groups, sorting and test policy", () => {
    const source = {
      version: 2,
      doubleColumn: false,
      sortBy: "delay-desc",
      groupOrder: ["B", "A", "B", ""],
      hiddenGroups: ["Hidden", "Hidden", ""],
      delayTestUrl: "  https://example.test/ping  ",
      delayTimeoutMs: 7_500,
    };
    const migrated = migrateProxySettings(source);

    expect(migrated.migrated).toBe(true);
    expect(migrated.settings).toMatchObject({
      version: 3,
      doubleColumn: false,
      sortBy: "delay-desc",
      groupOrder: ["B", "A"],
      hiddenGroups: ["Hidden"],
      delayTestUrl: "https://example.test/ping",
      delayTimeoutMs: 7_500,
    });
    expect(migrated.settings.displayGlobalByMode).toBe(true);
    expect(migrated.settings.proxyPreviewType).toBe("auto");
    expect(migrated.settings.proxyGroupIconSize).toBe(24);
    expect(migrated.settings.proxyGroupIconMargin).toBe(12);
  });

  it("repairs a version-3 object with missing fields and marks it migrated", () => {
    const migrated = migrateProxySettings({ version: 3, doubleColumn: false });
    expect(migrated.migrated).toBe(true);
    expect(migrated.settings.version).toBe(3);
    expect(migrated.settings.doubleColumn).toBe(false);
    expect(migrated.settings.displayGlobalByMode).toBe(true);
    expect(migrated.settings.groupOrder).toEqual([]);
    expect(migrated.settings.hiddenGroups).toEqual([]);
  });
});

describe("Zashboard aliases and boundary normalization", () => {
  it("maps appearance aliases and compact/comfortable card sizes", () => {
    expect(
      migrateProxySettings({
        version: 2,
        groupByProvider: true,
        manageHiddenGroup: true,
        showFinalOutbound: true,
        disableTextSelect: false,
        nodePreviewType: "dots",
        nodeCardSize: "small",
        groupIconSize: 28,
        groupIconMargin: 8,
      }).settings,
    ).toMatchObject({
      groupProxiesByProvider: true,
      manageHiddenGroups: true,
      displayFinalOutbound: true,
      disableProxiesPageTextSelect: false,
      proxyPreviewType: "dots",
      proxyCardSize: "compact",
      proxyGroupIconSize: 28,
      proxyGroupIconMargin: 8,
    });

    expect(normalizeProxySettings({ proxyCardSize: "large" }).proxyCardSize).toBe("comfortable");
    expect(normalizeProxySettings({ proxyPreviewType: "bar" }).proxyPreviewType).toBe("bar");
  });

  it("rejects non-http test URLs and clamps timeout/width/icon boundaries", () => {
    const settings = normalizeProxySettings({
      delayTestUrl: "ftp://invalid.example",
      delayTimeoutMs: 9,
      minProxyCardWidth: 9_999,
      proxyGroupIconSize: -10,
      proxyGroupIconMargin: 999,
    });
    expect(settings.delayTestUrl).toBe(DEFAULT_PROXY_SETTINGS.delayTestUrl);
    expect(settings.delayTimeoutMs).toBe(1_000);
    expect(settings.minProxyCardWidth).toBe(640);
    expect(settings.proxyGroupIconSize).toBe(12);
    expect(settings.proxyGroupIconMargin).toBe(32);

    const upper = normalizeProxySettings({
      delayTestUrl: "http://example.test",
      delayTimeoutMs: 999_999,
      minProxyCardWidth: 96,
      proxyGroupIconSize: 64,
      proxyGroupIconMargin: 0,
    });
    expect(upper.delayTestUrl).toBe("http://example.test");
    expect(upper.delayTimeoutMs).toBe(120_000);
    expect(upper.minProxyCardWidth).toBe(96);
    expect(upper.proxyGroupIconSize).toBe(64);
    expect(upper.proxyGroupIconMargin).toBe(0);
  });

  it("falls back from invalid preview and sort values", () => {
    const settings = normalizeProxySettings({ proxyPreviewType: "bars", sortBy: "random" });
    expect(settings.proxyPreviewType).toBe("auto");
    expect(settings.sortBy).toBe("default");
  });
});

describe("proxy settings storage repair", () => {
  it("round-trips every setting exposed by both proxy settings dialogs", () => {
    const storage = makeStorage();
    const expected = {
      groupProxiesByProvider: true,
      hideUnavailable: true,
      showHiddenProxies: true,
      manageHiddenGroups: true,
      autoDisconnectOnSwitch: false,
      displayFinalOutbound: true,
      disableProxiesPageTextSelect: false,
      minProxyCardWidth: 192,
      doubleColumn: false,
      delayTestUrl: "https://example.test/generate_204",
      delayTimeoutMs: 9_000,
      nodeNameDisplay: "wrap" as const,
      displayGlobalByMode: false,
      proxyPreviewType: "bar" as const,
      proxyCardSize: "compact" as const,
      proxyGroupIconSize: 32,
      proxyGroupIconMargin: 8,
    };

    writeProxySettings(expected, storage);

    expect(readProxySettings(storage)).toMatchObject(expected);
  });

  it("read/write/reset persist version 3 under the stable v2 key", () => {
    const storage = makeStorage();
    const written = writeProxySettings({ doubleColumn: false, hiddenGroups: ["A"] }, storage);
    expect(written.version).toBe(3);
    expect(JSON.parse(storage.values.get(PROXY_SETTINGS_KEY_V2) ?? "{}").version).toBe(3);

    const read = readProxySettings(storage);
    expect(read.version).toBe(3);
    expect(read.doubleColumn).toBe(false);
    expect(read.hiddenGroups).toEqual(["A"]);
    expect(read.hiddenGroups).not.toBe(written.hiddenGroups);

    const reset = resetProxySettings(storage);
    expect(reset.version).toBe(3);
    expect(JSON.parse(storage.values.get(PROXY_SETTINGS_KEY_V2) ?? "{}").version).toBe(3);
    expect(reset.hiddenGroups).toEqual([]);
  });

  it("repairs malformed JSON with a fresh version-3 default", () => {
    const storage = makeStorage({ [PROXY_SETTINGS_KEY_V2]: "{not-json" });
    const settings = readProxySettings(storage);
    expect(settings.version).toBe(3);
    expect(settings).toMatchObject(DEFAULT_PROXY_SETTINGS);
    expect(JSON.parse(storage.values.get(PROXY_SETTINGS_KEY_V2) ?? "{}").version).toBe(3);
  });
});

describe("settings dialog semantic guardrails", () => {
  const sourcePath = (name: string) =>
    fileURLToPath(new URL(`../../components/mihomo/proxies/${name}`, import.meta.url));

  it("exposes the requested two-level controls without folders or duplicate icon settings", () => {
    const primary = readFileSync(sourcePath("ProxySettingsDialog.tsx"), "utf8");
    const more = readFileSync(sourcePath("ProxyMoreSettingsDialog.tsx"), "utf8");
    const source = `${primary}\n${more}`;

    for (const label of [
      "groupProxiesByProvider",
      "hideUnavailable",
      "manageHiddenGroups",
      "showHiddenProxies",
      "autoDisconnectOnSwitch",
      "displayFinalOutbound",
      "disableProxiesPageTextSelect",
      "minProxyCardWidth",
      "doubleColumn",
      "displayGlobalByMode",
      "proxyPreviewType",
      "proxyCardSize",
      "proxyGroupIconSize",
      "proxyGroupIconMargin",
      "delayTestUrl",
      "delayTimeoutMs",
    ]) {
      expect(source, `missing control ${label}`).toContain(label);
    }
    expect(source).toContain("更多设置");
    expect(source).not.toContain("proxyFolderMode");
    expect(source).not.toContain("文件夹模式");
    expect(source).not.toContain("IconSettings");
    expect(source).not.toContain("自定义图标");
  });

  it("does not render the legacy low/high delay fields in either dialog", () => {
    const primary = readFileSync(sourcePath("ProxySettingsDialog.tsx"), "utf8");
    const more = readFileSync(sourcePath("ProxyMoreSettingsDialog.tsx"), "utf8");
    const source = `${primary}\n${more}`;

    expect(source).not.toContain("delayLowMs");
    expect(source).not.toContain("delayHighMs");
    expect(source).not.toMatch(/<(?:input|GlassField)[^>]*(?:低延迟|高延迟)/u);
  });

  it("uses the localized supplier grouping label", () => {
    const primary = readFileSync(sourcePath("ProxySettingsDialog.tsx"), "utf8");

    expect(primary).toContain("按供应商分组节点");
    expect(primary).not.toContain("按 Provider 分组节点");
  });

  it("applies icon margin literally and gives compact cards a distinct density", () => {
    const groupCard = readFileSync(sourcePath("ProxyGroupCard.tsx"), "utf8");
    const nodeCard = readFileSync(sourcePath("ProxyNodeCard.tsx"), "utf8");
    const nodeGrid = readFileSync(sourcePath("ProxyNodeGrid.tsx"), "utf8");

    expect(groupCard).toContain('"flex min-w-0 items-start gap-0 px-4 py-3"');
    expect(groupCard).toContain("marginRight: iconMargin");
    expect(nodeCard).toContain('"rounded-lg px-2 py-1.5 shadow-none"');
    expect(nodeCard).toContain('"h-5 min-w-8 px-1"');
    expect(nodeGrid).toContain('cardSize === "compact" ? "gap-1" : "gap-2"');
    expect(nodeGrid).toContain('cardSize === "compact" ? "space-y-2 p-1.5" : "space-y-3 p-2"');
  });

  it("keeps the full node card selectable without turning delay tests into selections", () => {
    const nodeCard = readFileSync(sourcePath("ProxyNodeCard.tsx"), "utf8");

    expect(nodeCard).toContain('role={onSelect ? "button" : undefined}');
    expect(nodeCard).toContain("onClick={onSelect}");
    expect(nodeCard).toContain('event.key === "Enter" || event.key === " "');
    expect(nodeCard).toContain("event.stopPropagation(); onTest();");
  });
});
