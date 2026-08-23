import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";

const samples = [
  { label: "Scale 0", filter: "gary-edge-refraction-0" },
  { label: "Scale 24", filter: "gary-edge-refraction" },
  { label: "Scale 48", filter: "gary-edge-refraction-48" },
] as const;

export function LiquidGlassLab() {
  const [activeScale, setActiveScale] = useState<(typeof samples)[number]>(samples[0]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">开发验证面</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">Liquid Glass Lab</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            使用同一背景比较 scale 0 / 24 / 48。只有边缘折射产生稳定可见差异，正式导航才允许启用 SVG filter。
          </p>
        </div>

        <GlassSurface material="thick" className="p-5 md:p-7">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="折射强度">
            {samples.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => setActiveScale(sample)}
                className={activeScale.label === sample.label ? "gary-glass-button rounded-xl px-4 py-2 text-sm font-medium text-primary" : "gary-glass-button rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground"}
                aria-pressed={activeScale.label === sample.label}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <div className="gary-lab-grid rounded-[22px] p-5 md:p-10">
            <div className="mx-auto max-w-xl space-y-3">
              <div
                aria-label="折射测试表面"
                className="gary-glass gary-glass--ultrathin flex min-h-40 items-center justify-center rounded-[30px] px-6 text-center"
                style={{
                  WebkitBackdropFilter: `url(#${activeScale.filter}) blur(14px) saturate(108%)`,
                  backdropFilter: `url(#${activeScale.filter}) blur(14px) saturate(108%)`,
                }}
              >
                <div>
                  <div className="text-xl font-semibold text-foreground">折射验证表面</div>
                  <div className="mt-1 text-xs text-muted-foreground">文字与位置固定，仅修改 displacement scale</div>
                </div>
              </div>
              <SolidPlate className="px-3 py-2 text-xs text-muted-foreground">
                当前参数：{activeScale.label}。截图目标只包含上方表面，按钮和参数文本不进入像素对比区域。
              </SolidPlate>
            </div>
            <div className="sr-only">
              {samples.map((sample) => (
                <span key={sample.label}>{sample.label}</span>
              ))}
            </div>
          </div>
        </GlassSurface>

        <div className="grid gap-4 md:grid-cols-4">
          <GlassSurface material="ultrathin" className="min-h-28 p-5">
            <div className="text-sm font-semibold">UltraThin</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">导航、rails 与常驻 chrome。</p>
          </GlassSurface>
          <GlassSurface material="regular" className="min-h-28 p-5">
            <div className="text-sm font-semibold">Regular</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">按钮、Tab、输入与工具组。</p>
          </GlassSurface>
          <GlassSurface material="thick" className="min-h-28 p-5">
            <div className="text-sm font-semibold">Thick</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">关键数据卡与图表外壳。</p>
          </GlassSurface>
          <SolidPlate className="min-h-28 p-5">
            <div className="text-sm font-semibold">SolidPlate</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">表格、日志、配置和密集参数。</p>
          </SolidPlate>
        </div>
      </div>
    </AppShell>
  );
}
