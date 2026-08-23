import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const GlassField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function GlassField(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn("gary-field px-3 text-foreground placeholder:text-muted-foreground", className)} {...props} />;
});
