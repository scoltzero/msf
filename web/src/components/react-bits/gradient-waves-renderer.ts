/* Shader adapted from React Bits GradientWaves under its MIT + Commons Clause terms. */
export type GradientWavesProps = {
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  speed?: number;
  amplitude?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  tilt?: number;
  zoom?: number;
  height?: number;
  fogDepth?: number;
  detail?: "low" | "medium" | "high";
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  parallaxStrength?: number;
  grain?: boolean;
  grainIntensity?: number;
  saturation?: number;
  contrast?: number;
  postBrightness?: number;
  maxRenderPixels?: number;
  maxDpr?: number;
  powerPreference?: WebGLPowerPreference;
  className?: string;
};


export type WaveOptions = Required<Omit<GradientWavesProps, "className" | "maxDpr" | "maxRenderPixels" | "powerPreference">>;
export type WaveFrame = { options: WaveOptions; width: number; height: number; visible: boolean; pointer: [number, number] };
export type WaveMessage = { type: "init"; canvas: OffscreenCanvas; frame: WaveFrame; powerPreference: WebGLPowerPreference } | { type: "update"; frame: WaveFrame };
const vertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution; uniform float iTime; uniform float uSpeed; uniform float uAmplitude;
uniform float uWaveScale; uniform float uWaveRatio; uniform float uSwell; uniform float uTurbulence;
uniform float uTilt; uniform float uZoom; uniform float uHeight; uniform float uFogDepth; uniform float uSteps;
uniform float uBrightness; uniform float uOpacity; uniform float uGrain; uniform float uGrainIntensity;
uniform float uSaturation; uniform float uContrast; uniform float uPostBrightness;
uniform vec2 uMouse; uniform float uParallax; uniform bool uEnableMouse;
uniform vec3 uHorizonColor; uniform vec3 uWaveColor; uniform vec3 uCrestColor;
out vec4 fragColor; const float MAX_DIST=20000.0;
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float plasma(vec3 r,vec2 freq,vec4 tc){float mx=r.x+tc.x;mx+=uSwell*sin((r.y+mx)/20.0+tc.y);float my=r.y-tc.z;my+=uTurbulence*cos(r.x/23.0+tc.w);return r.z-(sin(mx*freq.x)*uAmplitude+sin(my*freq.y)*uAmplitude+uHeight);}
float raymarch(vec3 pos,vec3 dir,vec2 freq,vec4 tc){float dist=0.0;for(int i=0;i<128;i++){if(float(i)>=uSteps)break;float dscene=plasma(pos+dist*dir,freq,tc);if(abs(dscene)<0.1)break;dist+=0.9*dscene;if(!(abs(dist)<MAX_DIST))return MAX_DIST;}return dist;}
void main(){
 float T=iTime*uSpeed;vec2 freq=vec2(uWaveScale/7.0,(uWaveScale*uWaveRatio)/3.0);vec4 tc=vec4(T/0.130,T/0.810,T/0.200,T/0.710);
 float c,s;float vfov=(3.14159/2.3)/max(uZoom,0.05);vec3 cam=vec3(0.0,0.0,30.0);vec2 uv=(gl_FragCoord.xy/iResolution.xy)-0.5;uv.x*=iResolution.x/iResolution.y;uv.y*=-1.0;
 vec3 dir=vec3(0.0,0.0,-1.0);float ulen=length(uv);float xrot=vfov*ulen;c=cos(xrot);s=sin(xrot);dir=mat3(1.0,0.0,0.0,0.0,c,-s,0.0,s,c)*dir;
 vec2 nuv=ulen>1e-5?uv/ulen:vec2(1.0,0.0);c=nuv.x;s=nuv.y;dir=mat3(c,-s,0.0,s,c,0.0,0.0,0.0,1.0)*dir;c=cos(uTilt);s=sin(uTilt);dir=mat3(c,0.0,s,0.0,1.0,0.0,-s,0.0,c)*dir;
 if(uEnableMouse){float yaw=(uMouse.x-0.5)*uParallax*0.4;float pitch=(uMouse.y-0.5)*uParallax*0.4;c=cos(yaw);s=sin(yaw);dir=mat3(c,0.0,s,0.0,1.0,0.0,-s,0.0,c)*dir;c=cos(pitch);s=sin(pitch);dir=mat3(1.0,0.0,0.0,0.0,c,-s,0.0,s,c)*dir;}
 float dist=raymarch(cam,dir,freq,tc);vec3 pos=cam+dist*dir;float t=clamp(uFogDepth/max(dist,0.001),0.0,1.0);vec3 body=mix(uWaveColor,uCrestColor,clamp(pos.z*0.08+0.5,0.0,1.0));vec3 col=mix(uHorizonColor,body,t);
 float luma=dot(col,vec3(0.2126,0.7152,0.0722));col=mix(vec3(luma),col,uSaturation);col=(col-0.5)*uContrast+0.5;col=clamp(col*uBrightness*uPostBrightness,0.0,1.0);
 float alpha=clamp(t,0.0,1.0)*uOpacity;if(uGrain>0.5){float g=hash21(gl_FragCoord.xy+mod(iTime,64.0)*11.0);alpha+=(g-0.5)*uGrainIntensity;}alpha=clamp(alpha,0.0,1.0);fragColor=vec4(col*alpha,alpha);
}`;


const rgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return new Float32Array(m ? m.slice(1).map(v => parseInt(v, 16) / 255) : [1, 1, 1]);
};

export function createWaveRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, initial: WaveFrame, powerPreference: WebGLPowerPreference) {
  // This full-screen triangle needs no OGL capability/extension discovery.
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 unavailable");
  let frame = initial;
  let disposed = false;
  let raf = 0;
  let elapsed = 0;
  let lastFrame = performance.now();
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const requestFrame = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame.bind(globalThis)
    : (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
  const cancelFrame = typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame.bind(globalThis)
    : (id: number) => clearTimeout(id);
  const dispose = () => {
    disposed = true;
    if (raf) cancelFrame(raf);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    if (!program || !buffer) throw new Error("Wave GPU allocation failed");
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Wave shader allocation failed");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Wave shader link failed");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const locations = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    };
    let colors = [rgb(initial.options.horizonColor), rgb(initial.options.waveColor), rgb(initial.options.crestColor)];
    const pointer: [number, number] = [0.5, 0.5];
    const draw = (time: number) => {
      raf = 0;
      if (disposed || !frame.visible) return;
      elapsed += Math.max(0, time - lastFrame);
      lastFrame = time;
      const p = frame.options;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.uniform2f(loc("iResolution"), canvas.width, canvas.height);
      gl.uniform1f(loc("iTime"), elapsed * 0.001);
      const floats = {
        uSpeed: p.speed, uAmplitude: p.amplitude, uWaveScale: p.waveScale, uWaveRatio: p.waveRatio,
        uSwell: p.swell, uTurbulence: p.turbulence, uTilt: p.tilt, uZoom: p.zoom,
        uHeight: p.height, uFogDepth: p.fogDepth, uSteps: p.detail === "low" ? 40 : p.detail === "high" ? 110 : 70,
        uBrightness: p.brightness, uOpacity: p.opacity, uGrain: p.grain ? 1 : 0,
        uGrainIntensity: p.grainIntensity, uParallax: p.parallaxStrength, uSaturation: p.saturation,
        uContrast: p.contrast, uPostBrightness: p.postBrightness,
      };
      Object.entries(floats).forEach(([name, value]) => gl.uniform1f(loc(name), value));
      gl.uniform1i(loc("uEnableMouse"), p.mouseInteraction ? 1 : 0);
      pointer[0] += 0.05 * (frame.pointer[0] - pointer[0]);
      pointer[1] += 0.05 * (frame.pointer[1] - pointer[1]);
      gl.uniform2f(loc("uMouse"), pointer[0], pointer[1]);
      gl.uniform3fv(loc("uHorizonColor"), colors[0]);
      gl.uniform3fv(loc("uWaveColor"), colors[1]);
      gl.uniform3fv(loc("uCrestColor"), colors[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (p.speed !== 0 || p.grain || p.mouseInteraction) raf = requestFrame(draw);
    };
    const start = () => {
      if (disposed || raf || !frame.visible) return;
      lastFrame = performance.now();
      raf = requestFrame(draw);
    };
    // The initial canvas may already have this size; set the viewport once.
    gl.viewport(0, 0, canvas.width, canvas.height);
    start();
    return {
      update(next: WaveFrame) {
        frame = next;
        colors = [rgb(next.options.horizonColor), rgb(next.options.waveColor), rgb(next.options.crestColor)];
        if (!frame.visible && raf) { cancelFrame(raf); raf = 0; }
        start();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

