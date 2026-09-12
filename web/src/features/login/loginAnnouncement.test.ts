import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/login/login.css", import.meta.url), "utf8");

describe("versioned login announcement", () => {
  it("separates session close from permanent dismissal", () => {
    expect(page).toContain('LOGIN_ANNOUNCEMENT_ID = "2026-09-v0.6.5-mosdns-cache-runtime"');
    expect(page).toContain("window.sessionStorage.setItem(LOGIN_ANNOUNCEMENT_SESSION_KEY, \"1\")");
    expect(page).toContain("window.localStorage.setItem(LOGIN_ANNOUNCEMENT_HIDDEN_KEY, \"1\")");
    expect(page).toContain("不再显示");
    expect(page).toContain('aria-label="关闭本次更新公告"');
    expect(page).toContain('className="msf-login-announcement"');
    expect(page).not.toContain("msf-login-announcement gary-glass");
  });

  it("contains the requested release notes and responsive bubble layout", () => {
    expect(page).toContain("v0.6.5：MosDNS 缓存与运行稳定性修复");
    expect(page).toContain("前置缓存不再持久化 FakeIP 响应");
    expect(page).toContain("Rule Provider 更新 405");
    expect(page).toContain("111 调整为 11101");
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
    const release = changelog.split("## v0.6.5 - 2026-09-13")[1]?.split("\n## v")[0];
    expect(release).toBeTruthy();
    expect(release).toContain("### 中文");
    expect(release).toContain("### English");
    expect(release).toContain("FakeIP");
    expect(release).toContain("11101");
    expect(release).toContain("升级注意事项");
    expect(release).toContain("Upgrade notes");
    expect(page).not.toContain("2026-09-v0.6.3-performance");
  });
});
