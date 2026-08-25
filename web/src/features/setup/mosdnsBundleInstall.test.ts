import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../pages/SetupPage.tsx", import.meta.url), "utf8");

describe("MosDNS setup bundle installation", () => {
  it("passes the selected interface for uploads and URL installs", () => {
    expect(source).toContain('body.append("interface", interfaceName)');
    expect(source).toContain('body: JSON.stringify({ url, interface: interfaceName })');
    expect(source).toContain("mosdnsBundleFile, form.selected_interface");
    expect(source).toContain("url, form.selected_interface");
  });

  it("installs the bundle before setup initialization", () => {
    const completeInitialize = source.slice(source.indexOf("const completeInitialize"), source.indexOf("const retryDownloads"));
    expect(completeInitialize.indexOf("installMosdnsBundle()")).toBeGreaterThan(-1);
    expect(completeInitialize.indexOf("installMosdnsBundle()")).toBeLessThan(completeInitialize.indexOf('api<any>("/api/v1/setup/initialize"'));
  });
});
