import { GripVertical, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import "./DashboardCard.css";

interface DashboardCardProps {
  title: string;
  icon: LucideIcon;
  className?: string;
  headerRight?: React.ReactNode;
  compact?: boolean;
  editing?: boolean;
  children: React.ReactNode;
}

export function DashboardCard({
  title,
  icon: Icon,
  className,
  headerRight,
  compact = false,
  editing = false,
  children,
}: DashboardCardProps) {
  return (
    <GlassSurface
      material="thick"
      data-dashboard-widget-card
      className={cn(
        "flex h-full flex-col text-card-foreground animate-fade-in",
        className
      )}
    >
      <div className={cn(
        "flex items-center justify-between border-b border-border/35",
        editing && "dashboard-widget-drag-handle cursor-grab select-none active:cursor-grabbing",
        compact ? "p-3" : "p-4"
      )} data-dashboard-card-header>
        <div className="flex min-w-0 items-center gap-2">
          {editing ? <GripVertical className="h-4 w-4 text-muted-foreground/65" aria-hidden="true" /> : null}
          <Icon className="h-5 w-5 shrink-0 text-primary" />
          <h3 className={cn("truncate font-semibold", compact && "text-sm")} title={title}>{title}</h3>
        </div>
        {headerRight ? <div className="ml-2 flex shrink-0 items-center">{headerRight}</div> : null}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-hidden", compact ? "p-3" : "p-4")}>{children}</div>
    </GlassSurface>
  );
}
