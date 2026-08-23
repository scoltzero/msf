import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";

export function WorkbenchHeader({
  icon: Icon,
  title,
  description,
  status,
  actions,
  summary,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <GlassSurface
      material="thick"
      className={cn("shrink-0 px-4 py-3", className)}
      style={{ "--gary-local-radius": "20px" } as CSSProperties}
      data-workbench-header
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight text-foreground md:text-xl">{title}</h1>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {status ? <div className="flex shrink-0 flex-wrap items-center gap-2">{status}</div> : null}
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
      </header>
      {summary ? <div className="mt-2.5 border-t border-border/40 pt-2.5">{summary}</div> : null}
    </GlassSurface>
  );
}
