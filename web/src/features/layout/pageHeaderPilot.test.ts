import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMihomoMetaVersion } from "../../app/mihomo/config/page";

const pageHeader = readFileSync(new URL("../../components/layout/PageHeader.tsx", import.meta.url), "utf8");
const workbenchHeader = readFileSync(new URL("../../components/layout/WorkbenchHeader.tsx", import.meta.url), "utf8");
const mosdnsConfig = readFileSync(new URL("../../app/mosdns/service-config/page.tsx", import.meta.url), "utf8");
const mihomoConfig = readFileSync(new URL("../../app/mihomo/config/page.tsx", import.meta.url), "utf8");
const mosdnsOverview = readFileSync(new URL("../../app/mosdns/overview/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const mihomoOverview = readFileSync(new URL("../../app/mihomo/overview/page.tsx", import.meta.url), "utf8");
const mosdnsRules = readFileSync(new URL("../../app/mosdns/rules/page.tsx", import.meta.url), "utf8");
const mosdnsClients = readFileSync(new URL("../../app/mosdns/clients/page.tsx", import.meta.url), "utf8");
const mosdnsQueryLog = readFileSync(new URL("../../app/mosdns/query-log/page.tsx", import.meta.url), "utf8");
const connections = readFileSync(new URL("../../app/mihomo/connections/page.tsx", import.meta.url), "utf8");
const serviceManagement = readFileSync(new URL("../../components/management/ServiceManagementPage.tsx", import.meta.url), "utf8");
const systemHeader = readFileSync(new URL("../../components/mosdns/SystemHeader.tsx", import.meta.url), "utf8");
const logs = readFileSync(new URL("../../app/logs/page.tsx", import.meta.url), "utf8");
const proxyHeader = readFileSync(new URL("../../components/mihomo/proxies/ProxyPageHeader.tsx", import.meta.url), "utf8");
const ruleHeader = readFileSync(new URL("../../components/mihomo/rules/RulePageHeader.tsx", import.meta.url), "utf8");

describe("page header pilot", () => {
  it("keeps workbench headers on one 20px outer radius and one title scale", () => {
    expect(workbenchHeader).toContain('"--gary-local-radius": "20px"');
    expect(workbenchHeader).toContain('className="text-lg font-bold leading-tight text-foreground md:text-xl"');
    expect(workbenchHeader).toContain("data-workbench-header");
    expect(mosdnsConfig).toContain("<WorkbenchHeader");
    expect(mihomoConfig).toContain("<WorkbenchHeader");
    expect(mihomoConfig).toContain('title="Mihomo 配置管理"');
  });

  it("uses the icon-and-title header without an outer glass surface for overviews", () => {
    expect(pageHeader).toContain('className="text-xl font-bold leading-tight text-foreground md:text-2xl"');
    expect(pageHeader).not.toContain("GlassSurface");
    expect(mosdnsOverview).toContain("<PageHeader");
    expect(mosdnsOverview).toContain("icon={ChartColumn}");
    expect(mihomoOverview).toContain("<PageHeader");
    expect(home).toContain("<PageHeader");
  });

  it("routes management pages through the shared workbench header", () => {
    [mosdnsRules, mosdnsClients, mosdnsQueryLog, connections, serviceManagement, systemHeader, logs, proxyHeader, ruleHeader]
      .forEach((source) => expect(source).toContain("<WorkbenchHeader"));
  });

  it("shows only the short Meta core semantic version", () => {
    expect(formatMihomoMetaVersion("MetaCubeX Mihomo v1.19.29 linux amd64 build 20260823")).toBe("v1.19.29");
    expect(formatMihomoMetaVersion("1.20.0-alpha-abcdef")).toBe("v1.20.0");
    expect(formatMihomoMetaVersion("")).toBe("-");
    expect(mihomoConfig).toContain("maxHeight={560}");
    expect(mihomoConfig).toContain('h-[560px]');
    expect(mihomoConfig).not.toContain("当前配置：{currentConfigName}");
    expect(mihomoConfig).not.toContain("{modeInfo.protected_warning}");
  });
});
