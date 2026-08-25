import fragmentShaderSource from "./effect.frag.glsl?raw";
import vertexShaderSource from "./effect.vert.glsl?raw";
import { type OrbParams } from "./presets";
import { writeOrbUniforms } from "./orb-uniforms";

export type OrbWebGLRendererOptions = {
  canvas: HTMLCanvasElement;
  getParams: () => OrbParams;
  isPaused?: () => boolean;
  onError: (error: Error) => void;
  onReady: () => void;
};

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 WebGL2 着色器");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "未知编译错误";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 着色器编译失败：${message}`);
  }
  return shader;
}

export function createOrbWebGLRenderer({
  canvas,
  getParams,
  isPaused = () => false,
  onError,
  onReady,
}: OrbWebGLRendererOptions): () => void {
  let disposed = false;
  let animationFrame = 0;
  let readyNotified = false;
  let failed = false;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniformBuffer: WebGLBuffer | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;

  function fail(error: Error): void {
    if (disposed || failed) return;
    failed = true;
    cancelAnimationFrame(animationFrame);
    onError(error);
  }

  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("当前浏览器无法创建 WebGL2 画布上下文");

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    program = gl.createProgram();
    if (!program) throw new Error("无法创建 WebGL2 渲染程序");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL2 程序链接失败：${gl.getProgramInfoLog(program) || "未知链接错误"}`);
    }

    uniformBuffer = gl.createBuffer();
    vertexArray = gl.createVertexArray();
    if (!uniformBuffer || !vertexArray) throw new Error("无法创建 WebGL2 缓冲区");
    const blockIndex = gl.getUniformBlockIndex(program, "Uniforms_block_0Fragment");
    if (blockIndex === gl.INVALID_INDEX) throw new Error("WebGL2 着色器缺少 Uniforms 数据块");
    gl.uniformBlockBinding(program, blockIndex, 0);
    gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, 128 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, uniformBuffer);
    gl.bindVertexArray(vertexArray);
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);

    const values = new Float32Array(128);
    const startedAt = performance.now();

    function resize(): void {
      if (!gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    }

    function frame(now: number): void {
      if (disposed || failed || !gl || !program || !uniformBuffer || !vertexArray) return;
      try {
        if (!isPaused()) {
          resize();
          writeOrbUniforms(values, canvas.width, canvas.height, (now - startedAt) / 1000, getParams());
          gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
          gl.bufferSubData(gl.UNIFORM_BUFFER, 0, values);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program);
          gl.bindVertexArray(vertexArray);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (!readyNotified) {
            readyNotified = true;
            onReady();
          }
        }
        animationFrame = requestAnimationFrame(frame);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }

    animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    if (gl) {
      if (uniformBuffer) gl.deleteBuffer(uniformBuffer);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (program) gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}
