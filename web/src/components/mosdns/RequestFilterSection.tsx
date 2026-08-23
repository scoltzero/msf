"use client";

import { Ban, CircleSlash2, ListX, ShieldX, type LucideIcon } from "lucide-react";
import type { FilterSettings } from "@/lib/mosdns-system-data";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";

interface FilterToggleProps {
  label: string;
  description: string;
  icon: LucideIcon;
  checked: boolean;
  onToggle: () => void;
}

function FilterToggle({ label, description, icon: Icon, checked, onToggle }: FilterToggleProps) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-foreground/[0.025]">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-emerald-500" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}

interface RequestFilterSectionProps {
  filterSettings: FilterSettings;
  onToggleAdBlock: () => void;
  onToggleRequestBlock: () => void;
  onToggleTypeBlock: () => void;
  onToggleIpv6Block: () => void;
}

export function RequestFilterSection({
  filterSettings,
  onToggleAdBlock,
  onToggleRequestBlock,
  onToggleTypeBlock,
  onToggleIpv6Block,
}: RequestFilterSectionProps) {
  return (
    <GlassSurface material="thick" className="rounded-2xl">
      <div className="flex items-center gap-2 p-4 pb-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldX className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-base font-semibold tracking-tight">请求过滤层</h3>
          <p className="text-xs text-muted-foreground">控制 DNS 请求的处理与拦截</p>
        </div>
      </div>
      <div className="grid gap-1 p-3 pt-0 sm:grid-cols-2">
        <FilterToggle icon={Ban} label="广告屏蔽" description="启用 AdGuard 在线规则" checked={filterSettings.adBlock} onToggle={onToggleAdBlock} />
        <FilterToggle icon={CircleSlash2} label="请求屏蔽" description="屏蔽无解析结果请求" checked={filterSettings.requestBlock} onToggle={onToggleRequestBlock} />
        <FilterToggle icon={ListX} label="类型屏蔽" description="屏蔽 SOA/PTR/HTTPS 请求" checked={filterSettings.typeBlock} onToggle={onToggleTypeBlock} />
        <FilterToggle icon={ShieldX} label="IPv6 屏蔽" description="阻止 AAAA 请求类型" checked={filterSettings.ipv6Block} onToggle={onToggleIpv6Block} />
      </div>
    </GlassSurface>
  );
}
