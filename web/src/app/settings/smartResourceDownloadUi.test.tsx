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

  it("supports cancellation and non-overlapping polling that stops outside downloads", () => {
    expect(editorSource).toContain("/api/v1/mihomo/smart-resources/cancel");
    expect(editorSource).toContain("取消下载");
    expect(editorSource).toContain("window.setTimeout(() => void refresh(), 2000)");
    expect(editorSource).not.toContain("window.setInterval");
    expect(editorSource).toContain('resource?.status === "downloading"');
  });

  it("prevents Smart editing on Meta and links to the core switch", () => {
    expect(editorSource).toContain("data.core_type");
    expect(editorSource).toContain('disabled={smartCoreType !== "smart"}');
    expect(editorSource).toContain("smart（需先切换核心）");
    expect(editorSource).toContain('/settings?tab=update');
    expect(editorSource).toContain("当前为官方 Meta 核心");
  });

  it("shows an unset sample rate as automatic full sampling", () => {
    expect(editorSource).toContain('value={draft.sampleRate || ""}');
    expect(editorSource).toContain('placeholder="自动（默认 1.0）"');
    expect(editorSource).toContain("即全量采样");
  });
});
