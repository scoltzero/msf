import { stylePresets, type OrbParams } from "./vendor/ler-sent001-orb/presets";
import { createOrbRenderer as createVendorRenderer } from "./vendor/ler-sent001-orb/orb-renderer";
import { createOrbWebGLRenderer } from "./vendor/ler-sent001-orb/orb-webgl-renderer";
import type { OrbRenderState } from "./OrbRenderer.types";

export type { OrbRenderState } from "./OrbRenderer.types";

const stateStyles: Record<OrbRenderState, keyof typeof stylePresets> = {
  idle: "siri",
  thinking: "aurora",
  tool: "spectrum",
  success: "opal",
  warning: "violetEmber",
  error: "voiceWave",
};

export type OrbRendererBackend = "webgpu" | "webgl2";

export class OrbRenderer {
  private params: OrbParams = { style: "siri", ...stylePresets.siri } as OrbParams;
  private cleanup: (() => void) | null = null;
  private paused = false;
  private state: OrbRenderState = "idle";

  constructor(private readonly canvas: HTMLCanvasElement) {}

  init() {
    return new Promise<OrbRendererBackend>((resolve, reject) => {
      const startWebGL2 = () => {
        this.cleanup?.();
        this.cleanup = createOrbWebGLRenderer({
          canvas: this.canvas,
          getParams: () => this.params,
          isPaused: () => this.paused,
          onError: reject,
          onReady: () => resolve("webgl2"),
        });
      };
      this.cleanup = createVendorRenderer({
        canvas: this.canvas,
        getParams: () => this.params,
        isPaused: () => this.paused,
        onError: startWebGL2,
        onReady: () => resolve("webgpu"),
      });
    });
  }

  setState(state: OrbRenderState) {
    this.state = state;
    const style = stateStyles[state];
    this.params = { style, ...stylePresets[style] } as OrbParams;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  resize() {
    // The vendor renderer reads the CSS canvas size before every frame.
    // ResizeObserver is still used by the React owner to wake a new frame.
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}
