import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tool" | "danger";
};

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { variant = "secondary", className, ...props },
  ref
) {
  return <button ref={ref} className={cn("gary-glass-button", `gary-glass-button--${variant}`, className)} {...props} />;
});
