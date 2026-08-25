import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../app/settings/SettingsClient.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../components/AppShell.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const scene = readFileSync(new URL("../../components/liquid-glass/SceneBackdrop.tsx", import.meta.url), "utf8");
const sceneStyles = readFileSync(new URL("../../styles/liquid-glass-scenes.css", import.meta.url), "utf8");

describe("appearance initialization contract", () => {
  it("defaults new browsers to dynamic balanced without overriding explicit quality", () => {
    expect(main).toContain('root.dataset.garyScene = savedScene === "static" || savedScene === "neutral" ? savedScene : "dynamic"');
    expect(main).toContain('savedQuality === "full" || savedQuality === "reduced" ? savedQuality : "balanced"');
    expect(settings).toContain('useState<GlassQuality>("balanced")');
    expect(settings).toContain('storedQuality === "full" || storedQuality === "reduced" ? storedQuality : "balanced"');
  });

  it("uses the complete v0.4.7.x scene on both the app shell and login", () => {
    expect(settings).toContain("主页与登录页恢复 v0.4.7.5 / v0.4.7.7 的静态背景特效");
    expect(shell).toContain("<SceneBackdrop />");
    expect(login).toContain("<SceneBackdrop />");
    expect(scene).toContain('className="gary-scene__legacy-gradient"');
    expect(scene).toContain('className="gary-scene__legacy-silk"');
    expect(sceneStyles).toContain(".gary-scene__legacy-gradient::before");
    expect(sceneStyles).toContain("radial-gradient(ellipse 56% 44% at 18% 18%, var(--gary-scene-a), transparent 72%)");
    expect(sceneStyles).toContain(".gary-scene__legacy-gradient::after");
    expect(sceneStyles).toContain(".gary-scene__legacy-silk");
    expect(sceneStyles).toContain("color-mix(in srgb, var(--gary-scene-a) 66%, transparent)");
  });
});
