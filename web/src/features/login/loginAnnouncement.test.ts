import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/login/login.css", import.meta.url), "utf8");

describe("versioned login announcement", () => {
  it("separates session close from permanent dismissal", () => {
    expect(page).toContain('LOGIN_ANNOUNCEMENT_ID = "2026-11-v0.6.7.2-proxy-upstreams"');
    expect(page).toContain("window.sessionStorage.setItem(LOGIN_ANNOUNCEMENT_SESSION_KEY, \"1\")");
    expect(page).toContain("window.localStorage.setItem(LOGIN_ANNOUNCEMENT_HIDDEN_KEY, \"1\")");
    expect(page).toContain("不再显示");
    expect(page).toContain('aria-label="关闭本次更新公告"');
    expect(page).toContain('className="msf-login-announcement"');
    expect(page).not.toContain("msf-login-announcement gary-glass");
  });

  it("contains the requested release notes and responsive bubble layout", () => {
    expect(page).toContain("v0.6.7.2：代理与上游管理改进");
    expect(page).toContain("供应商与测速配置");
    expect(page).toContain("Secret 复制与订阅更新");
    expect(page).toContain("更新全部订阅");
    expect(page).toContain("MosDNS 上游排序");
    expect(page).toContain("上游列表顺序不代表主备优先级");
    expect(page).toContain("升级提示");
    expect(styles).toContain(".msf-login-announcement");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("height: auto");
    expect(styles).toContain("max-height: min(18rem, calc(100dvh - 2rem))");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("grid-template-columns: 1fr");
  });

  it("pairs the new announcement with a bilingual versioned changelog", () => {
    const changelog = readFileSync(new URL("../../../../CHANGELOG.md", import.meta.url), "utf8");
    const release = changelog.split("## v0.6.7.2 - 2026-11-03")[1]?.split("\n## v")[0];
    expect(release).toBeTruthy();
    expect(release).toContain("### 中文");
    expect(release).toContain("### English");
    expect(release).toContain("Fix [#22]");
    expect(release).toContain("Update all subscriptions");
    expect(release).toContain("within-group MosDNS upstream ordering");
    expect(release).toContain("This release does not change the MosDNS core");
    expect(release).toContain("复制");
    expect(release).toContain("排序");
    expect(page).not.toContain("2026-10-v0.6.7.1-dns-safe-mode");
  });
});
