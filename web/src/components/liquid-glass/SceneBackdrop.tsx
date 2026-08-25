import { useEffect, useState } from "react";
import GradientWaves from "@/components/react-bits/GradientWaves";

const WAVE_PALETTES = {
  light: {
    horizon: "#f3fbff",
    wave: "#00366f",
    crest: "#24d7ee",
  },
  dark: {
    horizon: "#0d0f11",
    wave: "#243241",
    crest: "#126b9e",
  },
} as const;

type SceneMode = "dynamic" | "static" | "neutral";
type QualityMode = "full" | "balanced" | "reduced";
type ScenePerformanceProfile = "default" | "proxy-dense";

function readBackdropState() {
  const root = document.documentElement;
  const rawScene = root.dataset.garyScene;
  const rawQuality = root.dataset.garyQuality;
  const rawPerformanceProfile = root.dataset.garySceneProfile;

  return {
    dark: root.classList.contains("dark"),
    scene: (rawScene === "static" || rawScene === "neutral" ? rawScene : "dynamic") as SceneMode,
    quality: (rawQuality === "balanced" || rawQuality === "reduced" ? rawQuality : "full") as QualityMode,
    performanceProfile: (rawPerformanceProfile === "proxy-dense" ? rawPerformanceProfile : "default") as ScenePerformanceProfile,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function SceneBackdrop() {
  const [state, setState] = useState(readBackdropState);

  useEffect(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncState = () => setState(readBackdropState());
    const observer = new MutationObserver(syncState);

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-gary-scene", "data-gary-quality", "data-gary-scene-profile"],
    });
    reducedMotion.addEventListener?.("change", syncState);
    syncState();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener?.("change", syncState);
    };
  }, []);

  const palette = state.dark ? WAVE_PALETTES.dark : WAVE_PALETTES.light;
  const animated = state.scene === "dynamic" && !state.reducedMotion;
  const qualityProfile = state.quality === "reduced"
    ? { speed: 0.12, detail: "low" as const, pixels: 650_000, proxyPixels: 500_000, dpr: 0.75 }
    : state.quality === "balanced"
      ? { speed: 0.16, detail: "low" as const, pixels: 1_200_000, proxyPixels: 900_000, dpr: 1 }
      : { speed: 0.2, detail: "medium" as const, pixels: 2_300_000, proxyPixels: 1_200_000, dpr: 1.5 };
  const visible = state.scene !== "neutral";
  const proxyDense = state.performanceProfile === "proxy-dense";

  return (
    <div className="gary-scene" aria-hidden="true">
      {state.scene === "neutral" ? (
        <div className="gary-scene__legacy-gradient">
          <div className="gary-scene__legacy-silk" />
        </div>
      ) : null}
      {visible && (
        <GradientWaves
          key={`${state.dark ? "dark" : "light"}-${state.quality}-${state.performanceProfile}`}
          className="gary-scene__gradient-waves"
          horizonColor={palette.horizon}
          waveColor={palette.wave}
          crestColor={palette.crest}
          speed={animated ? qualityProfile.speed : 0}
          amplitude={3.4}
          waveScale={0.72}
          waveRatio={0.9}
          swell={38}
          turbulence={22}
          tilt={1.11}
          zoom={1}
          height={5.5}
          fogDepth={48}
          detail={qualityProfile.detail}
          brightness={1}
          opacity={1}
          mouseInteraction={false}
          parallaxStrength={0}
          grain={false}
          saturation={state.dark ? 0.9 : 1.062}
          contrast={state.dark ? 1.24 : 1.32}
          postBrightness={state.dark ? 0.9 : 1}
          maxRenderPixels={proxyDense ? qualityProfile.proxyPixels : qualityProfile.pixels}
          maxDpr={qualityProfile.dpr}
          powerPreference="high-performance"
        />
      )}
    </div>
  );
}
