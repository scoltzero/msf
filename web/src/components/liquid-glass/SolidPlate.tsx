import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SolidPlateTone = "subtle" | "regular" | "strong";

export type SolidPlateProps = HTMLAttributes<HTMLDivElement> & {
  tone?: SolidPlateTone;
  /** @deprecated Prefer tone="strong". */
  strong?: boolean;
};

export const SolidPlate = forwardRef<HTMLDivElement, SolidPlateProps>(function SolidPlate(
  { tone, strong = false, className, ...props },
  ref
) {
  const resolvedTone = tone ?? (strong ? "strong" : "regular");

  return <div ref={ref} className={cn("gary-solid-plate", `gary-solid-plate--${resolvedTone}`, className)} {...props} />;
});
