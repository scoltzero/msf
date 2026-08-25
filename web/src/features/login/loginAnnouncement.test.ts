import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/login/login.css", import.meta.url), "utf8");

describe("versioned login announcement", () => {
  it("separates session close from permanent dismissal", () => {
    expect(page).toContain('LOGIN_ANNOUNCEMENT_ID = "2026-08-mihomo-config-ai-agent"');
    expect(page).toContain("window.sessionStorage.setItem(LOGIN_ANNOUNCEMENT_SESSION_KEY, \"1\")");
    expect(page).toContain("window.localStorage.setItem(LOGIN_ANNOUNCEMENT_HIDDEN_KEY, \"1\")");
    expect(page).toContain("不再显示");
    expect(page).toContain('aria-label="关闭本次更新公告"');
    expect(page).toContain('className="msf-login-announcement"');
    expect(page).not.toContain("msf-login-announcement gary-glass");
  });

  it("contains the requested release notes and responsive bubble layout", () => {
    expect(page).toContain("全新的 Mihomo 配置");
    expect(page).toContain("OpenAI Responses");
    expect(page).toContain("可自定义 Skill");
    expect(page).toContain("Star 与 Fork");
    expect(styles).toContain(".msf-login-announcement");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("height: auto");
    expect(styles).toContain("max-height: min(18rem, calc(100dvh - 2rem))");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});
