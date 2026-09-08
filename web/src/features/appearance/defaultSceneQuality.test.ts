import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../app/settings/SettingsClient.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../components/AppShell.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const scene = readFileSync(new URL("../../components/liquid-glass/SceneBackdrop.tsx", import.meta.url), "utf8");
const waves = readFileSync(new URL("../../components/react-bits/GradientWaves.tsx", import.meta.url), "utf8");
const sceneStyles = readFileSync(new URL("../../styles/liquid-glass-scenes.css", import.meta.url), "utf8");
const skin = readFileSync(new URL("../../lib/skin.ts", import.meta.url), "utf8");
const amberSkin = readFileSync(new URL("../../styles/skin-amber.css", import.meta.url), "utf8");

describe("appearance initialization contract", () => {
  it("resizes the persistent waves without remounting on route or quality changes", () => {
    expect(scene).not.toContain("key={");
    expect(waves).toContain("const { options, maxDpr, maxRenderPixels } = current.current");
    expect(waves).toContain("syncRef.current = sync");
    expect(waves).toContain("syncRef.current();");
    expect(waves).toContain("}, [powerPreference]);");
    expect(waves).not.toContain("}, [maxDpr, maxRenderPixels, powerPreference]);");
  });
  it("defaults new browsers to dynamic balanced without overriding explicit quality", () => {
    expect(main).toContain('root.dataset.garyScene = savedScene === "static" || savedScene === "neutral" ? savedScene : "dynamic"');
    expect(main).toContain('savedQuality === "full" || savedQuality === "reduced" ? savedQuality : "balanced"');
    expect(settings).toContain('useState<GlassQuality>("balanced")');
    expect(settings).toContain('storedQuality === "full" || storedQuality === "reduced" ? storedQuality : "balanced"');
    expect(login).toContain("normalizeGlassQuality(root.dataset.garyQuality)");
    expect(login).toContain("maxRenderPixels={qualityProfile.pixels}");
    expect(login).toContain("maxDpr={qualityProfile.dpr}");
  });

  it("keeps classic glass as the default skin and lets login waves follow skin tokens", () => {
    expect(skin).toContain('DEFAULT_SKIN: SkinId = "classic"');
    expect(login).toContain('attributeFilter: ["class", "data-gary-scene", "data-gary-quality", "data-skin"]');
    expect(login).toContain('getPropertyValue("--gary-scene-wave-horizon")');
    expect(login).toContain('getPropertyValue("--gary-scene-wave")');
    expect(login).toContain('getPropertyValue("--gary-scene-wave-crest")');
    expect(amberSkin).toContain('--gary-scene-wave: #7a4a24');
    expect(amberSkin).toContain('--gary-scene-wave-crest: #fb923c');
  });

  it("uses the complete v0.4.7.x scene on both the app shell and login", () => {
    expect(settings).toContain("主页与登录页恢复 v0.4.7.5 / v0.4.7.7 的静态背景特效");
    expect(shell).not.toContain("<SceneBackdrop />");
    expect(readFileSync(new URL("../../App.tsx", import.meta.url), "utf8")).toContain("<SceneBackdrop />");
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
