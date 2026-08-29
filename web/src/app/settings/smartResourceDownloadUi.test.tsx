import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Smart proxy-group resource downloads", () => {
  const editorSource = readFileSync(
    new URL("../../components/mihomo/proxies/ProxyGroupEditorDialog.tsx", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("../../components/mihomo/proxies/ProxyEditorShell.tsx", import.meta.url),
    "utf8",
  );

  it("starts official resource downloads when LightGBM or ASN is selected", () => {
    expect(editorSource).toContain("/api/v1/mihomo/smart-resources/download");
    expect(editorSource).toContain('startSmartResourceDownload("lightgbm")');
    expect(editorSource).toContain('startSmartResourceDownload("asn")');
    expect(editorSource).toContain("github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin");
    expect(editorSource).toContain("github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb");
  });

  it("shows progress and blocks validation/save until required files are ready", () => {
    expect(editorSource).toContain("下载进度");
    expect(editorSource).toContain("resourceBlocked");
    expect(editorSource).toContain("actionDisabled={resourceBlocked}");
    expect(shellSource).toContain("disabled || actionDisabled || validating || saving");
    expect(shellSource).toContain("disabled || actionDisabled || saving || validating");
  });
});
