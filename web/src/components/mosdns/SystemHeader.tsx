"use client";

import { Save, Globe } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";

interface SystemHeaderProps {
  onSave: () => void;
  saving?: boolean;
}

export function SystemHeader({ onSave, saving = false }: SystemHeaderProps) {
  return (
    <WorkbenchHeader
      icon={Globe}
      title="系统控制"
      description="上游配置、过滤策略与缓存管理"
      actions={(
        <GlassButton
          variant="primary"
          onClick={onSave}
          disabled={saving}
          className="shrink-0 text-sm disabled:cursor-wait disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline">{saving ? "保存中..." : "保存并重启"}</span>
          <span className="sm:hidden">{saving ? "保存中" : "保存"}</span>
        </GlassButton>
      )}
    />
  );
}
