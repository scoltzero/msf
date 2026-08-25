import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(new URL("../../app/settings/SettingsClient.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../../components/AppHeader.tsx", import.meta.url), "utf8");

describe("release repository links", () => {
  it("uses the project repository for update metadata and help links", () => {
    expect(settingsSource).toContain('const RELEASE_REPO_OWNER = "zAhYAng"');
    expect(settingsSource).not.toContain('const RELEASE_REPO_OWNER = "scoltzero"');
    expect(headerSource).toContain("https://github.com/zAhYAng/msf/blob/main/README.md");
    expect(headerSource).not.toContain("https://github.com/scoltzero/msf");
  });
});
