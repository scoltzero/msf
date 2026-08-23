import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassSurface } from "./GlassSurface";

export function GlassDialog({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <GlassSurface material="thick" strong className={cn("gary-glass--overflow-visible", className)} role="dialog" aria-modal="true" {...props}>
      {children}
    </GlassSurface>
  );
}
