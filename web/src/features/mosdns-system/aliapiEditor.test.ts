import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(new URL("../../components/mosdns/UpstreamServerDialog.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/mosdns/system/page.tsx", import.meta.url), "utf8");

// forward 迁移后 aliapi 协议不再受支持：编辑器只保留 udp/tcp/tls/https/quic/h3。
describe("MosDNS upstream editor after forward migration", () => {
  it("no longer offers the aliapi protocol or its credential fields", () => {
    for (const field of ["账户 ID", "Access Key ID", "Access Key Secret", "ECS Mask", '"aliapi"']) {
      expect(dialog).not.toContain(field);
    }
  });

  it("keeps the secret redaction plumbing for stored overrides", () => {
    for (const key of ["access_key_secret", "access_key_secret_set"]) {
      expect(page).toContain(key);
    }
    expect(page).toContain("redactLocalUpstreamSecrets");
    expect(page).toContain("delete raw.access_key_secret");
  });
});
