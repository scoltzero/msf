import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  defaultConfigRequiresUserSave,
  normalizeClientConfigName,
} from "@/app/mihomo/config/page";

describe("Mihomo config user-save flow", () => {
  it("recognizes both rejected HTTP requests and success:false payloads", () => {
    expect(defaultConfigRequiresUserSave(new ApiError(
      400,
      "default_config_requires_user_config",
      "save as user config",
      {},
    ))).toBe(true);
    expect(defaultConfigRequiresUserSave({
      success: false,
      error: "default_config_requires_user_config",
    })).toBe(true);
    expect(defaultConfigRequiresUserSave({ error: "invalid_config" })).toBe(false);
  });

  it("normalizes safe user config names and rejects reserved paths", () => {
    expect(normalizeClientConfigName("my-config")).toBe("my-config.yaml");
    expect(normalizeClientConfigName("my-config.yml")).toBe("my-config.yml");
    expect(normalizeClientConfigName("../config.yaml")).toBe("");
    expect(normalizeClientConfigName("config.yaml")).toBe("");
  });

  it("uses an in-page naming dialog instead of a browser prompt", () => {
    const source = readFileSync(new URL("../mihomo/config/page.tsx", import.meta.url), "utf8");
    expect(source).toContain("保存为用户配置");
    expect(source).toContain('aria-labelledby="mihomo-save-user-config-title"');
    expect(source).toContain("confirmUserConfigSave");
    expect(source).not.toContain("window.prompt");
  });
});
