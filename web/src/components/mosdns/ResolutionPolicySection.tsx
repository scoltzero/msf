"use client";

import { ArrowLeftRight, ChevronDown, Route } from "lucide-react";
import type { RunMode, ResolutionSettings } from "@/lib/mosdns-system-data";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";

interface ResolutionPolicySectionProps {
  runMode: RunMode;
  onChangeRunMode: (mode: RunMode) => void;
  resolutionSettings: ResolutionSettings;
  onChangePriority: (priority: "auto" | "ipv4" | "ipv6") => void;
  prioritySaving?: boolean;
}

export function ResolutionPolicySection({
  runMode,
  onChangeRunMode,
  resolutionSettings,
  onChangePriority,
  prioritySaving = false,
}: ResolutionPolicySectionProps) {
  const priority = resolutionSettings.ipv4First ? "ipv4" : resolutionSettings.ipv6First ? "ipv6" : "auto";

  return (
    <GlassSurface material="thick" className="rounded-2xl">
      <div className="flex items-center gap-2 p-4 pb-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Route className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-base font-semibold tracking-tight">解析策略层</h3>
          <p className="text-xs text-muted-foreground">运行模式与协议优先级</p>
        </div>
      </div>

      <div className="grid gap-3 p-4 pt-1 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">运行模式</span>
          </div>
          <GlassSegmentedControl
            value={runMode}
            options={[
              { id: "compatible", label: "兼容模式" },
              { id: "safe", label: "安全模式" },
            ]}
            onChange={onChangeRunMode}
            ariaLabel="运行模式"
            className="w-full"
            itemClassName="min-w-0 flex-1 text-center"
          />
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">协议优先级</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="协议优先级">
            {([
              ["auto", "自动"],
              ["ipv4", "IPv4 优先"],
              ["ipv6", "IPv6 优先"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={priority === value}
                disabled={prioritySaving}
                onClick={() => onChangePriority(value)}
                className={cn(
                  "rounded-lg px-2 py-2 text-sm transition-[background-color,box-shadow,color] disabled:cursor-wait disabled:opacity-60",
                  priority === value ? "bg-background/75 text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/45 hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <details className="group border-t border-border/40 pt-2 text-xs text-muted-foreground md:col-span-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground/80">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            策略说明
          </summary>
          <div className="mt-2 grid gap-1 leading-relaxed sm:grid-cols-2">
            <p>自动：同时保留上游实际存在的 A 与 AAAA。</p>
            <p>IPv4 优先：双栈域名存在 A 时抑制 AAAA，v6-only 域名仍返回 AAAA。</p>
            <p>IPv6 优先：双栈域名存在 AAAA 时抑制 A，v4-only 域名仍返回 A。</p>
            <p>该策略直接在主分流序列内执行，不会通过 localhost 二次转发。</p>
          </div>
        </details>
      </div>
    </GlassSurface>
  );
}
