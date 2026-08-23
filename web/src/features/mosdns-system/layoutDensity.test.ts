import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mosdns/system/page.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../../components/mosdns/SystemHeader.tsx", import.meta.url), "utf8");
const globalSettings = readFileSync(new URL("../../components/mosdns/GlobalSettingsCard.tsx", import.meta.url), "utf8");
const filters = readFileSync(new URL("../../components/mosdns/RequestFilterSection.tsx", import.meta.url), "utf8");
const resolution = readFileSync(new URL("../../components/mosdns/ResolutionPolicySection.tsx", import.meta.url), "utf8");
const segmented = readFileSync(new URL("../../components/liquid-glass/GlassSegmentedControl.tsx", import.meta.url), "utf8");
const upstream = readFileSync(new URL("../../components/mosdns/UpstreamDNSSection.tsx", import.meta.url), "utf8");

describe("MosDNS system layout density", () => {
  it("keeps the shared workbench title and uses safe desktop columns", () => {
    expect(header).toContain("<WorkbenchHeader");
    expect(page).toContain("2xl:grid-cols-2");
    expect(page).toContain("grid grid-cols-1 gap-4 lg:grid-cols-2");
  });

  it("consolidates global settings without removing controls", () => {
    expect(globalSettings.match(/<GlassSurface/g)).toHaveLength(1);
    for (const control of ["SOCKS5", "ECS IP", "日志容量", "设置"]) {
      expect(globalSettings).toContain(control);
    }
  });

  it("keeps every filter and resolution option in compact groups", () => {
    for (const label of ["广告屏蔽", "请求屏蔽", "类型屏蔽", "IPv6 屏蔽"]) {
      expect(filters).toContain(label);
    }
    for (const label of ["兼容模式", "安全模式", "自动", "IPv4 优先", "IPv6 优先", "策略说明"]) {
      expect(resolution).toContain(label);
    }
    expect(segmented).toContain("itemClassName?: string");
    expect(resolution).toContain('itemClassName="min-w-0 flex-1 text-center"');
    expect(upstream).toContain("md:grid-cols-[40px_minmax(120px,0.8fr)_58px_minmax(180px,1.2fr)_64px]");
    expect(upstream).toContain("whitespace-nowrap");
  });
});
