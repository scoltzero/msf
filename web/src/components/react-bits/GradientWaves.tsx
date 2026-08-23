/* Adapted from React Bits GradientWaves under its MIT + Commons Clause terms. */
import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";

import "./GradientWaves.css";

type GradientWavesProps = {
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

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
};

const detailToSteps = (detail: GradientWavesProps["detail"]) => detail === "low" ? 40 : detail === "high" ? 110 : 70;

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

export default function GradientWaves({
  horizonColor = "#dff4ff", waveColor = "#39a8e8", crestColor = "#f7fdff", speed = 0.4,
  amplitude = 2.5, waveScale = 0.6, waveRatio = 0.9, swell = 35, turbulence = 20, tilt = 1.11,
  zoom = 1, height = 5.5, fogDepth = 15, detail = "medium", brightness = 1, opacity = 1,
  mouseInteraction = true, parallaxStrength = 0.5, grain = true, grainIntensity = 0.05,
  saturation = 1, contrast = 1, postBrightness = 1, maxRenderPixels = Number.POSITIVE_INFINITY,
  maxDpr = 2, powerPreference = "default", className = "",
}: GradientWavesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<Program | null>(null);
  const pointerRectRef = useRef<DOMRect | null>(null);
  const pointerTargetRef = useRef<[number, number]>([0.5, 0.5]);
  const startRenderingRef = useRef<() => void>(() => undefined);
  const propsRef = useRef({ speed, mouseInteraction, parallaxStrength, grain });
  propsRef.current = { speed, mouseInteraction, parallaxStrength, grain };

  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    const uniforms = program.uniforms;
    uniforms.uSpeed.value = speed;
    uniforms.uAmplitude.value = amplitude;
    uniforms.uWaveScale.value = waveScale;
    uniforms.uWaveRatio.value = waveRatio;
    uniforms.uSwell.value = swell;
    uniforms.uTurbulence.value = turbulence;
    uniforms.uTilt.value = tilt;
    uniforms.uZoom.value = zoom;
    uniforms.uHeight.value = height;
    uniforms.uFogDepth.value = fogDepth;
    uniforms.uSteps.value = detailToSteps(detail);
    uniforms.uBrightness.value = brightness;
    uniforms.uOpacity.value = opacity;
    uniforms.uGrain.value = grain ? 1 : 0;
    uniforms.uGrainIntensity.value = grainIntensity;
    uniforms.uParallax.value = parallaxStrength;
    uniforms.uEnableMouse.value = mouseInteraction;
    uniforms.uSaturation.value = saturation;
    uniforms.uContrast.value = contrast;
    uniforms.uPostBrightness.value = postBrightness;
    const horizon = uniforms.uHorizonColor.value as Float32Array;
    const wave = uniforms.uWaveColor.value as Float32Array;
    const crest = uniforms.uCrestColor.value as Float32Array;
    horizon.set(hexToRgb(horizonColor));
    wave.set(hexToRgb(waveColor));
    crest.set(hexToRgb(crestColor));
    startRenderingRef.current();
  }, [amplitude, brightness, contrast, crestColor, detail, fogDepth, grain, grainIntensity, height, horizonColor, mouseInteraction, opacity, parallaxStrength, postBrightness, saturation, speed, swell, tilt, turbulence, waveColor, waveRatio, waveScale, zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new Renderer({ webgl: 2, alpha: true, premultipliedAlpha: true, antialias: false, dpr: 1, powerPreference });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    container.appendChild(canvas);
    const geometry = new Triangle(gl);
    const program = new Program(gl, { vertex, fragment, uniforms: {
      iTime:{value:0},iResolution:{value:new Float32Array([1,1])},uSpeed:{value:speed},uAmplitude:{value:amplitude},uWaveScale:{value:waveScale},uWaveRatio:{value:waveRatio},uSwell:{value:swell},uTurbulence:{value:turbulence},uTilt:{value:tilt},uZoom:{value:zoom},uHeight:{value:height},uFogDepth:{value:fogDepth},uSteps:{value:detailToSteps(detail)},uBrightness:{value:brightness},uOpacity:{value:opacity},uGrain:{value:grain?1:0},uGrainIntensity:{value:grainIntensity},uSaturation:{value:saturation},uContrast:{value:contrast},uPostBrightness:{value:postBrightness},uMouse:{value:new Float32Array([0.5,0.5])},uParallax:{value:parallaxStrength},uEnableMouse:{value:mouseInteraction},uHorizonColor:{value:new Float32Array(hexToRgb(horizonColor))},uWaveColor:{value:new Float32Array(hexToRgb(waveColor))},uCrestColor:{value:new Float32Array(hexToRgb(crestColor))}
    }});
    programRef.current = program;
    const mesh = new Mesh(gl, { geometry, program });
    let previousWidth = 0;
    let previousHeight = 0;
    let previousDpr = 0;
    const setSize = () => {
      const rect = container.getBoundingClientRect();
      pointerRectRef.current = rect;
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));
      const pixelBudgetDpr = Number.isFinite(maxRenderPixels)
        ? Math.sqrt(maxRenderPixels / Math.max(1, cssWidth * cssHeight))
        : Number.POSITIVE_INFINITY;
      const nextDpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, maxDpr, pixelBudgetDpr));
      if (cssWidth === previousWidth && cssHeight === previousHeight && Math.abs(nextDpr - previousDpr) < 0.001) return;
      previousWidth = cssWidth;
      previousHeight = cssHeight;
      previousDpr = nextDpr;
      renderer.dpr = nextDpr;
      renderer.setSize(cssWidth, cssHeight);
      const res = program.uniforms.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
    };
    const ro = new ResizeObserver(setSize); ro.observe(container); setSize();
    const current=[0.5,0.5];
    let raf=0;
    let elapsed=0;
    let lastFrame=performance.now();
    let documentVisible=!document.hidden;
    let elementVisible=true;
    const stop=()=>{if(raf){cancelAnimationFrame(raf);raf=0;}};
    const loop=(time:number)=>{
      raf=0;
      const delta=Math.max(0,time-lastFrame);
      lastFrame=time;
      elapsed+=delta;
      const p=propsRef.current;
      program.uniforms.iTime.value=elapsed*0.001;
      if(p.mouseInteraction){const target=pointerTargetRef.current;current[0]+=.05*(target[0]-current[0]);current[1]+=.05*(target[1]-current[1]);const mouse=program.uniforms.uMouse.value as Float32Array;mouse[0]=current[0];mouse[1]=current[1];}
      renderer.render({scene:mesh});
      if(documentVisible&&elementVisible&&(p.speed!==0||p.grain||p.mouseInteraction))raf=requestAnimationFrame(loop);
    };
    const start=()=>{if(raf||!documentVisible||!elementVisible)return;lastFrame=performance.now();raf=requestAnimationFrame(loop);};
    startRenderingRef.current=start;
    const onVisibilityChange=()=>{documentVisible=!document.hidden;if(documentVisible)start();else stop();};
    const intersectionObserver=typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry])=>{elementVisible=entry?.isIntersecting??true;if(elementVisible)start();else stop();});
    intersectionObserver?.observe(container);
    document.addEventListener("visibilitychange",onVisibilityChange);
    start();
    return()=>{stop();ro.disconnect();intersectionObserver?.disconnect();document.removeEventListener("visibilitychange",onVisibilityChange);startRenderingRef.current=()=>undefined;programRef.current=null;pointerRectRef.current=null;canvas.remove();gl.getExtension("WEBGL_lose_context")?.loseContext();};
  }, [maxDpr, maxRenderPixels, powerPreference]);

  useEffect(() => {
    if (!mouseInteraction) return;
    const onPointerMove = (event: PointerEvent) => {
      const rect = pointerRectRef.current;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      pointerTargetRef.current[0] = (event.clientX - rect.left) / rect.width;
      pointerTargetRef.current[1] = 1 - (event.clientY - rect.top) / rect.height;
    };
    const onPointerLeave = () => {
      pointerTargetRef.current[0] = 0.5;
      pointerTargetRef.current[1] = 0.5;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [mouseInteraction]);

  return <div ref={containerRef} className={`gradient-waves-container ${className}`.trim()} aria-hidden="true" />;
}
