import { useEffect, useState } from "react";
import GradientWaves from "@/components/react-bits/GradientWaves";
import { GLASS_QUALITY_PROFILES, normalizeGlassQuality } from "@/lib/glass-quality";

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

/** The WebGL waves resolve their palette from skin variables so every skin
 * (including custom CSS overrides) restyles the dynamic scene as well. */
function readWavePalette(dark: boolean) {
  const fallback = dark ? WAVE_PALETTES.dark : WAVE_PALETTES.light;
  if (typeof window === "undefined") return fallback;
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, fallbackValue: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallbackValue;
  };
  return {
    horizon: read("--gary-scene-wave-horizon", fallback.horizon),
    wave: read("--gary-scene-wave", fallback.wave),
    crest: read("--gary-scene-wave-crest", fallback.crest),
  };
}

type SceneMode = "dynamic" | "static" | "neutral";
type ScenePerformanceProfile = "default" | "proxy-dense";

function readBackdropState() {
  const root = document.documentElement;
  const rawScene = root.dataset.garyScene;
  const rawQuality = root.dataset.garyQuality;
  const rawPerformanceProfile = root.dataset.garySceneProfile;

  return {
    dark: root.classList.contains("dark"),
    scene: (rawScene === "static" || rawScene === "neutral" ? rawScene : "dynamic") as SceneMode,
    quality: normalizeGlassQuality(rawQuality),
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
      attributeFilter: ["class", "data-gary-scene", "data-gary-quality", "data-gary-scene-profile", "data-skin"],
    });
    reducedMotion.addEventListener?.("change", syncState);
    syncState();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener?.("change", syncState);
    };
  }, []);

  const palette = readWavePalette(state.dark);
  const animated = state.scene === "dynamic" && !state.reducedMotion;
  const qualityProfile = GLASS_QUALITY_PROFILES[state.quality];
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
