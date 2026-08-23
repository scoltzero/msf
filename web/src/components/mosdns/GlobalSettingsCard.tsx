"use client";

import { BarChart3, Globe2, Info, Settings2 } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import type { GlobalSettings } from "@/lib/mosdns-system-data";

interface GlobalSettingsCardProps {
  settings: GlobalSettings;
  onChangeSocks5: (val: string) => void;
  onChangeEcsIp: (val: string) => void;
  onChangeLogCapacity: (val: number) => void;
  onSaveLogCapacity?: () => void;
}

export function GlobalSettingsCard({
  settings,
  onChangeSocks5,
  onChangeEcsIp,
  onChangeLogCapacity,
  onSaveLogCapacity,
}: GlobalSettingsCardProps) {
  return (
    <GlassSurface material="thick" className="rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-foreground">基础设置</h3>
          <p className="text-xs text-muted-foreground">代理出口、ECS 与日志容量</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(260px,0.8fr)]">
        <label className="flex min-w-0 items-center gap-2">
          <Globe2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">SOCKS5</span>
          <input
            type="text"
            value={settings.socks5}
            onChange={(event) => onChangeSocks5(event.target.value)}
            className="gary-field h-9 min-w-0 flex-1 px-3 text-xs"
          />
        </label>

        <label className="flex min-w-0 items-center gap-2">
          <Globe2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">ECS IP</span>
          <input
            type="text"
            value={settings.ecsIp}
            onChange={(event) => onChangeEcsIp(event.target.value)}
            className="gary-field h-9 min-w-0 flex-1 px-3 text-xs"
          />
        </label>

        <div className="md:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
            <label htmlFor="mosdns-log-capacity" className="shrink-0 text-xs font-medium text-muted-foreground">日志容量</label>
            <input
              id="mosdns-log-capacity"
              type="number"
              value={settings.logCapacity}
              onChange={(event) => onChangeLogCapacity(Number(event.target.value))}
              className="gary-field h-9 min-w-0 flex-1 px-3 text-xs"
            />
            <GlassButton variant="primary" onClick={onSaveLogCapacity} className="h-9 min-h-9 shrink-0 text-xs">
              设置
            </GlassButton>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />修改容量会清空日志，最高 40 万
          </p>
        </div>
      </div>
    </GlassSurface>
  );
}
