import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mihomo/proxies/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/mihomo/proxies/mihomo-proxies.css", import.meta.url), "utf8");
const scene = readFileSync(new URL("../../components/liquid-glass/SceneBackdrop.tsx", import.meta.url), "utf8");
const groupList = readFileSync(new URL("../../components/mihomo/proxies/ProxyGroupList.tsx", import.meta.url), "utf8");

describe("Mihomo proxy scene performance profile", () => {
  it("reduces the repeated-card blur only for the double-column layout", () => {
    expect(groupList).toContain('data-proxy-columns={isSplit ? "double" : "single"}');
    expect(styles).toContain('[data-proxy-columns="double"]');
    expect(styles).toContain("--gary-local-blur: 12px");
    expect(styles).toContain('[data-gary-quality="full"]');
    expect(styles).toContain('[data-proxy-columns="single"]');
    expect(styles).toContain("--gary-local-blur: 22px");
    expect(styles).toContain('[data-proxy-card-material="classic-glass"]::after');
    expect(styles).toContain("content: none");
    expect(styles).toContain("--gary-local-shadow: none");
    expect(styles).toContain("box-shadow: none");
  });

  it("caps the proxy background at 1.2 million pixels without pausing it while scrolling", () => {
    expect(page).toContain('const PROXY_SCENE_PROFILE = "proxy-dense"');
    expect(page).not.toContain("PROXY_SCROLL_IDLE_MS");
    expect(page).not.toContain("garyScrolling");
    expect(scene).toContain('state.performanceProfile === "proxy-dense"');
    expect(scene).toContain("proxyDense ? 1_200_000");
    expect(scene).toContain("speed={animated ? 0.2 : 0}");
    expect(scene).not.toContain("garyScrolling");
  });
});
