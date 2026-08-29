import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  defaultForm,
  normalizeSetupMihomoCore,
  setupInitializePayload,
  type SetupForm,
} from "@/pages/SetupPage";

describe("SetupPage · Mihomo core payload persistence", () => {
  it("sends the selected core type (meta) in the initialize payload", () => {
    const form: SetupForm = { ...defaultForm, mihomo_core_type: "meta" };
    const payload = setupInitializePayload(form, "机场|https://example.com/sub", "- name: 节点1");

    expect(payload.mihomo_core_type).toBe("meta");
    expect(payload.subscription_urls).toBe("机场|https://example.com/sub");
    expect(payload.mihomo_proxies).toBe("- name: 节点1");
  });

  it("sends smart instead of always hardcoding meta", () => {
    const form: SetupForm = { ...defaultForm, mihomo_core_type: "smart" };
    const payload = setupInitializePayload(form, "", "");

    expect(payload.mihomo_core_type).toBe("smart");
  });

  it("defaults to meta when no smart selection has been made", () => {
    expect(defaultForm.mihomo_core_type).toBe("meta");
  });

  it("restores smart/meta from a persisted setup config value", () => {
    expect(normalizeSetupMihomoCore("smart")).toBe("smart");
    expect(normalizeSetupMihomoCore("Smart")).toBe("smart");
    expect(normalizeSetupMihomoCore("meta")).toBe("meta");
    expect(normalizeSetupMihomoCore("mihomo")).toBe("meta");
    expect(normalizeSetupMihomoCore("")).toBe("meta");
    expect(normalizeSetupMihomoCore(undefined)).toBe("meta");
    expect(normalizeSetupMihomoCore(null)).toBe("meta");
  });
});

describe("SetupPage · amd64 v3 choice is preserved in the payload", () => {
  it("keeps amd64v3_enabled from the form", () => {
    const form: SetupForm = { ...defaultForm, amd64v3_enabled: true };
    const payload = setupInitializePayload(form, "", "");

    expect(payload.amd64v3_enabled).toBe(true);
  });
});

describe("SetupPage · compact Mihomo core controls", () => {
  it("uses two solid compact buttons inside the existing Mihomo card", () => {
    const source = readFileSync(new URL("./SetupPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("Meta（官方稳定版）");
    expect(source).toContain("smart（alpha核心）");
    expect(source).not.toContain("Mihomo 核心类型");
    expect(source).toContain("min-h-[108px]");
  });
});
