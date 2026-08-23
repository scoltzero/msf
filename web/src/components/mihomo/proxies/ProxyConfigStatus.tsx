import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProxyConfigStatusView } from "./types";

export function ProxyConfigStatus({ status, compact = false }: { status: ProxyConfigStatusView; compact?: boolean }) {
  const custom = status.mode === "custom";
  const unknown = !custom && status.mode !== "generated" && status.mode !== "default";
  const label = custom ? `自定义${status.activeName ? ` · ${status.activeName}` : ""}` : unknown ? "配置状态未知" : "默认配置";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-background/55 px-2.5 py-1 text-xs font-medium text-foreground/80",
        custom ? "text-primary" : "text-muted-foreground"
      )}
      title={status.activePath || status.runtimePath || undefined}
    >
      {custom ? <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
      {!compact && status.runtimePath ? <span className="hidden text-muted-foreground/70 sm:inline">· 运行 config.yaml</span> : null}
    </span>
  );
}
