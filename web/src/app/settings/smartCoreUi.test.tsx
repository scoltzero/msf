import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  MIHOMO_SWITCH_ENDPOINT,
  normalizeMihomoCoreType,
  mihomoActiveCore,
  mihomoSwitchBody,
  mihomoSwitchConfirm,
  mihomoCoreLabel,
  mihomoCurrentVersionLabel,
  mihomoReleaseSourceLabel,
  type ComponentUpdateState,
} from "@/app/settings/SettingsClient";

describe("Settings · Mihomo core branch switch", () => {
  it("targets the switch endpoint with a meta|smart JSON body", () => {
    expect(MIHOMO_SWITCH_ENDPOINT).toBe("/api/v1/component-updates/mihomo/switch");
    expect(JSON.parse(mihomoSwitchBody("smart"))).toEqual({ core_type: "smart" });
    expect(JSON.parse(mihomoSwitchBody("meta"))).toEqual({ core_type: "meta" });
  });

  it("normalizes any core type value to meta|smart", () => {
    expect(normalizeMihomoCoreType("smart")).toBe("smart");
    expect(normalizeMihomoCoreType("Smart")).toBe("smart");
    expect(normalizeMihomoCoreType("meta")).toBe("meta");
    expect(normalizeMihomoCoreType("mihomo")).toBe("meta");
    expect(normalizeMihomoCoreType("")).toBe("meta");
    expect(normalizeMihomoCoreType(undefined)).toBe("meta");
    expect(normalizeMihomoCoreType(null)).toBe("meta");
  });

  it("derives the active branch from update state", () => {
    expect(mihomoActiveCore(undefined)).toBe("meta");

    const meta: ComponentUpdateState = { component: "mihomo", core_type: "meta", installed_core_type: "meta" };
    expect(mihomoActiveCore(meta)).toBe("meta");

    const smart: ComponentUpdateState = { component: "mihomo", core_type: "smart", installed_core_type: "smart" };
    expect(mihomoActiveCore(smart)).toBe("smart");

    const installedSmart: ComponentUpdateState = { component: "mihomo", installed_core_type: "smart" };
    expect(mihomoActiveCore(installedSmart)).toBe("smart");
  });

  it("shows distinct guarded confirmation copy for smart vs meta", () => {
    const smart = mihomoSwitchConfirm("smart");
    const meta = mihomoSwitchConfirm("meta");

    expect(smart).toContain("Smart");
    expect(smart).toContain("第三方预发布");
    expect(meta).toContain("恢复 MSF 默认配置");
    expect(meta).toContain("用户配置文件会保留");
    expect(meta).not.toContain("第三方预发布");
  });

  it("labels branches and derives the release source label", () => {
    expect(mihomoCoreLabel("meta")).toBe("官方 Meta");
    expect(mihomoCoreLabel("smart")).toBe("Smart 实验版");

    const smart: ComponentUpdateState = { component: "mihomo", core_type: "smart" };
    expect(mihomoReleaseSourceLabel(smart)).toBe("Smart 实验版");

    const customSource: ComponentUpdateState = { component: "mihomo", release_source: "MetaCubeX/mihomo" };
    expect(mihomoReleaseSourceLabel(customSource)).toBe("MetaCubeX/mihomo");

    expect(mihomoReleaseSourceLabel(undefined)).toBe("官方稳定版");
  });

  it("shows the active core in the current-version line", () => {
    expect(mihomoCurrentVersionLabel({ current_version: "v1.19.30", core_type: "meta" })).toBe("Meta · v1.19.30");
    expect(mihomoCurrentVersionLabel({ current_version: "Prerelease-Alpha-b750813", core_type: "smart" })).toBe("Smart Alpha · Prerelease-Alpha-b750813");
  });

  it("keeps core switching in the existing action row without a separate panel", () => {
    const source = readFileSync(new URL("./SettingsClient.tsx", import.meta.url), "utf8");
    expect(source).toContain("核心切换");
    expect(source).not.toContain(">核心分支 / 来源<");
    expect(source).toContain("2xl:flex-row");
    expect(source).toContain('component === "mihomo" ? "grid grid-cols-2 2xl:flex 2xl:flex-wrap"');
    expect(source).not.toContain("gap-3 sm:flex-row sm:items-start");
  });
});
