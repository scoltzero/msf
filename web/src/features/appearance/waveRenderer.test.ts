import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createWaveRenderer, type WaveFrame } from "../../components/react-bits/gradient-waves-renderer";

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { callbacks.set(++sequence, fn); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ARRAY_BUFFER: 4, STATIC_DRAW: 5, FLOAT: 6, TRIANGLES: 7,
    createProgram: vi.fn(() => ({})), createShader: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program, name) => name), uniform1f: vi.fn(), uniform1i: vi.fn(),
    uniform2f: vi.fn(), uniform3fv: vi.fn(), viewport: vi.fn(), drawArrays: vi.fn(),
    deleteBuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(), getExtension: vi.fn(() => null),
  };
  const canvas = { width: 1, height: 1, getContext: vi.fn(() => gl) };
  const frame: WaveFrame = {
    width: 900, height: 600, visible: true, pointer: [0.5, 0.5],
    options: { horizonColor: "#f3fbff", waveColor: "#00366f", crestColor: "#24d7ee", speed: 0.16,
      amplitude: 3.4, waveScale: 0.72, waveRatio: 0.9, swell: 38, turbulence: 22, tilt: 1.11,
      zoom: 1, height: 5.5, fogDepth: 48, detail: "low", brightness: 1, opacity: 1,
      mouseInteraction: false, parallaxStrength: 0, grain: false, grainIntensity: 0.05,
      saturation: 1.062, contrast: 1.32, postBrightness: 1 },
  };
  const tick = () => { const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(fn => fn(performance.now() + 16)); };
  const create = () => createWaveRenderer(canvas as unknown as HTMLCanvasElement, frame, "high-performance");
  return { callbacks, gl, canvas, frame, tick, create };
}
afterEach(() => vi.unstubAllGlobals());

describe("wave render lifecycle", () => {
  it("draws the original full-screen triangle without capability discovery", () => {
    const f = fixture(); const renderer = f.create(); f.tick();
    expect(f.gl.getExtension).not.toHaveBeenCalled();
    expect(f.gl.bufferData.mock.calls[0][1]).toEqual(new Float32Array([-1, -1, 3, -1, -1, 3]));
    expect(f.gl.uniform1f).toHaveBeenCalledWith("uSteps", 40);
    expect(f.gl.uniform3fv).toHaveBeenCalledWith("uWaveColor", new Float32Array([0, 54 / 255, 111 / 255]));
    expect(f.gl.drawArrays).toHaveBeenCalledWith(f.gl.TRIANGLES, 0, 3);
    renderer.dispose();
  });
  it("updates palette and pixel budget without rebuilding the context", () => {
    const f = fixture(); const renderer = f.create(); f.tick();
    renderer.update({ ...f.frame, width: 500, height: 300, options: { ...f.frame.options, waveColor: "#7a4a24", detail: "medium" } }); f.tick();
    expect(f.canvas.getContext).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(500); expect(f.canvas.height).toBe(300);
    expect(f.gl.uniform1f).toHaveBeenCalledWith("uSteps", 70);
    expect(f.gl.uniform3fv).toHaveBeenCalledWith("uWaveColor", new Float32Array([122 / 255, 74 / 255, 36 / 255]));
    renderer.dispose();
  });
  it("pauses hidden rendering and resumes when visible", () => {
    const f = fixture(); f.frame.visible = false; const renderer = f.create();
    expect(f.callbacks.size).toBe(0);
    renderer.update({ ...f.frame, visible: true }); f.tick();
    expect(f.gl.drawArrays).toHaveBeenCalledTimes(1);
    renderer.update({ ...f.frame, visible: false }); expect(f.callbacks.size).toBe(0);
    renderer.dispose();
  });
  it("renders static mode once, and redraws it only for updates", () => {
    const f = fixture(); f.frame.options.speed = 0; const renderer = f.create(); f.tick();
    expect(f.callbacks.size).toBe(0);
    renderer.update({ ...f.frame }); f.tick(); expect(f.gl.drawArrays).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });
  it("releases resources and stops frames on disposal or link failure", () => {
    const f = fixture(); const renderer = f.create(); renderer.dispose();
    expect(f.callbacks.size).toBe(0); expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    renderer.update(f.frame); expect(f.callbacks.size).toBe(0);
    f.gl.getProgramParameter.mockReturnValue(false);
    expect(() => f.create()).toThrow("Wave shader link failed");
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(2);
  });
  it("fails cleanly when WebGL2 is unavailable", () => {
    expect(() => createWaveRenderer({ getContext: () => null } as unknown as HTMLCanvasElement, fixture().frame, "default")).toThrow("WebGL2 unavailable");
  });
  it("keeps transfer failure fallback and worker teardown wired", () => {
    const source = readFileSync(new URL("../../components/react-bits/GradientWaves.tsx", import.meta.url), "utf8");
    expect(source).toContain("transferControlToOffscreen");
    expect(source).toContain("fallbackStarted");
    expect(source).toContain("worker.onerror");
    expect(source).toContain("worker?.terminate()");
    expect(source).toContain('document.removeEventListener("visibilitychange", sync)');
  });
});
