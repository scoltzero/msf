import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type GlassMaterial = "ultrathin" | "regular" | "thick";

export type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  material?: GlassMaterial;
  strong?: boolean;
  refractive?: boolean;
  flat?: boolean;
};

export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(function GlassSurface(
  { material = "regular", strong = false, refractive = false, flat = false, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        "gary-glass",
        `gary-glass--${material}`,
        strong && "gary-glass--strong",
        refractive && "gary-glass--refractive",
        flat && "gary-glass--flat",
        className
      )}
      {...props}
    />
  );
});
