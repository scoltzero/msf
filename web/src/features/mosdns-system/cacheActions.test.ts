import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mosdns/system/page.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("../../components/mosdns/CacheSystemSection.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../components/dashboard/widgets/mosdns/MosdnsCacheSystemWidget.tsx", import.meta.url), "utf8");

describe("MosDNS cache actions", () => {
  it("separates DNS cache clearing from generated rule clearing", () => {
    expect(section).toContain("清空 DNS 缓存");
    expect(section).toContain("清空生成规则");
    expect(section).not.toContain("清空备份");
    expect(page).toContain('api<any>("/api/v1/mosdns/cache/clear"');
    expect(page).toContain('runRoutingAction("clear", "生成规则已清空")');
  });

  it("uses explicit confirmation copy and disables repeated actions", () => {
    expect(page).toContain("不会删除规则、订阅、配置或 Mihomo Fake-IP 数据库");
    expect(page).toContain("不会清理 DNS 缓存");
    expect(section).toContain("disabled={disabled}");
    expect(dashboard).toContain("data.clearDNSCache()");
    expect(dashboard).toContain('data.runCacheAction("clear")');
  });
});
