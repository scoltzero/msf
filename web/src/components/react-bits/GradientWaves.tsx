/* Adapted from React Bits GradientWaves under its MIT + Commons Clause terms. */
import { useEffect, useMemo, useRef } from "react";
import type { GradientWavesProps, WaveFrame, WaveOptions, WaveMessage } from "./gradient-waves-renderer";
import "./GradientWaves.css";

export default function GradientWaves({
  horizonColor = "#dff4ff", waveColor = "#39a8e8", crestColor = "#f7fdff", speed = 0.4,
  amplitude = 2.5, waveScale = 0.6, waveRatio = 0.9, swell = 35, turbulence = 20, tilt = 1.11,
  zoom = 1, height = 5.5, fogDepth = 15, detail = "medium", brightness = 1, opacity = 1,
  mouseInteraction = true, parallaxStrength = 0.5, grain = true, grainIntensity = 0.05,
  saturation = 1, contrast = 1, postBrightness = 1, maxRenderPixels = Number.POSITIVE_INFINITY,
  maxDpr = 2, powerPreference = "default", className = "",
}: GradientWavesProps) {

  const options = useMemo<WaveOptions>(() => ({ horizonColor, waveColor, crestColor, speed, amplitude, waveScale, waveRatio, swell, turbulence, tilt, zoom, height, fogDepth, detail, brightness, opacity, mouseInteraction, parallaxStrength, grain, grainIntensity, saturation, contrast, postBrightness }), [horizonColor, waveColor, crestColor, speed, amplitude, waveScale, waveRatio, swell, turbulence, tilt, zoom, height, fogDepth, detail, brightness, opacity, mouseInteraction, parallaxStrength, grain, grainIntensity, saturation, contrast, postBrightness]);
  const current = useRef({ options, maxDpr, maxRenderPixels });
  current.current = { options, maxDpr, maxRenderPixels };
  const containerRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let worker: Worker | undefined;
    let fallback: { update(frame: WaveFrame): void; dispose(): void } | undefined;
    let fallbackStarted = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let elementVisible = true;
    let rect = container.getBoundingClientRect();
    let pointer: [number, number] = [0.5, 0.5];
    let canvas = document.createElement("canvas");
    container.appendChild(canvas);
    const getFrame = (): WaveFrame => {
      const { options, maxDpr, maxRenderPixels } = current.current;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const budget = Number.isFinite(maxRenderPixels) ? Math.sqrt(maxRenderPixels / (width * height)) : Infinity;
      const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, maxDpr, budget));
      return { options, width: Math.floor(width * dpr), height: Math.floor(height * dpr),
        visible: !document.hidden && elementVisible, pointer };
    };
    const sync = () => {
      if (disposed) return;
      const frame = getFrame();
      if (worker) worker.postMessage({ type: "update", frame } satisfies WaveMessage);
      else fallback?.update(frame);
    };
    syncRef.current = sync;
    const startFallback = async () => {
      if (disposed || fallbackStarted) return;
      fallbackStarted = true;
      clearTimeout(watchdog);
      worker?.terminate();
      worker = undefined;
      // A transferred canvas cannot be reused on the main thread.
      canvas.remove();
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
      try {
        const { createWaveRenderer } = await import("./gradient-waves-renderer");
        if (disposed) return;
        fallback = createWaveRenderer(canvas, getFrame(), powerPreference);
        container.dataset.waveRenderer = "main";
      } catch {
        if (!disposed) container.dataset.waveRenderer = "unavailable";
      }
    };
    try {
      if (typeof Worker === "undefined" || typeof canvas.transferControlToOffscreen !== "function") {
        void startFallback();
      } else {
        worker = new Worker(new URL("./gradient-waves.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<{ type: string }>) => {
          if (disposed) return;
          if (event.data.type === "ready") {
            clearTimeout(watchdog);
            container.dataset.waveRenderer = "worker";
          } else if (event.data.type === "failed") void startFallback();
        };
        worker.onerror = (event) => { event.preventDefault(); void startFallback(); };
        const offscreen = canvas.transferControlToOffscreen();
        const initial: WaveMessage = { type: "init", canvas: offscreen, frame: getFrame(), powerPreference };
        worker.postMessage(initial, [offscreen]);
        watchdog = setTimeout(() => void startFallback(), 10000);
      }
    } catch { void startFallback(); }
    const resize = () => { rect = container.getBoundingClientRect(); sync(); };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const intersection = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(([entry]) => {
      elementVisible = entry?.isIntersecting ?? true;
      sync();
    });
    intersection?.observe(container);
    const move = (event: PointerEvent) => {
      if (!current.current.options.mouseInteraction || rect.width <= 0 || rect.height <= 0) return;
      pointer = [(event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height];
      sync();
    };
    const leave = () => { pointer = [0.5, 0.5]; sync(); };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      observer.disconnect();
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
      syncRef.current = () => undefined;
      worker?.terminate();
      fallback?.dispose();
      canvas.remove();
      delete container.dataset.waveRenderer;
    };
  }, [powerPreference]);
  useEffect(() => { syncRef.current(); }, [options, maxDpr, maxRenderPixels]);
  return <div ref={containerRef} className={`gradient-waves-container ${className}`.trim()} aria-hidden="true" />;
}
