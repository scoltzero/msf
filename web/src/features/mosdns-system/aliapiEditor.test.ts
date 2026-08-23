import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(new URL("../../components/mosdns/UpstreamServerDialog.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/mosdns/system/page.tsx", import.meta.url), "utf8");

describe("MosDNS ALIAPI upstream editor", () => {
  it("shows and validates every required credential field", () => {
    for (const field of ["账户 ID", "Access Key ID", "Access Key Secret", "服务器地址", "ECS Mask"]) {
      expect(dialog).toContain(field);
    }
    expect(dialog).toContain('type="password"');
    expect(dialog).toContain("ecsClientMask >= 0 && ecsClientMask <= 128");
    expect(dialog).toContain("已设置，留空则保持不变");
  });

  it("maps the editor values to MosDNS override keys and clears plaintext locally", () => {
    for (const key of ["account_id", "access_key_id", "access_key_secret", "access_key_secret_set", "server_addr", "ecs_client_mask"]) {
      expect(page).toContain(key);
    }
    expect(page).toContain("redactLocalUpstreamSecrets");
    expect(page).toContain("delete raw.access_key_secret");
  });
});
