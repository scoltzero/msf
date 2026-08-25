import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mihomo/proxies/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/mihomo/proxies/mihomo-proxies.css", import.meta.url), "utf8");
const scene = readFileSync(new URL("../../components/liquid-glass/SceneBackdrop.tsx", import.meta.url), "utf8");
const sceneStyles = readFileSync(new URL("../../styles/liquid-glass-scenes.css", import.meta.url), "utf8");
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

  it("keeps every visual quality tier animated while reducing its pixel budget", () => {
    expect(page).toContain('const PROXY_SCENE_PROFILE = "proxy-dense"');
    expect(page).not.toContain("PROXY_SCROLL_IDLE_MS");
    expect(page).not.toContain("garyScrolling");
    expect(scene).toContain('state.performanceProfile === "proxy-dense"');
    expect(scene).toContain("pixels: 2_300_000, proxyPixels: 1_200_000, dpr: 1.5");
    expect(scene).toContain("pixels: 1_200_000, proxyPixels: 900_000, dpr: 1");
    expect(scene).toContain("pixels: 650_000, proxyPixels: 500_000, dpr: 0.75");
    expect(scene).toContain('const animated = state.scene === "dynamic" && !state.reducedMotion');
    expect(scene).toContain("speed={animated ? qualityProfile.speed : 0}");
    expect(scene).toContain("proxyDense ? qualityProfile.proxyPixels : qualityProfile.pixels");
    expect(sceneStyles).not.toContain('data-gary-quality="reduced"');
    expect(scene).not.toContain("garyScrolling");
  });
});
