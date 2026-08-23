import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassSurface } from "./GlassSurface";

export interface GlassSegmentedOption<T extends string> {
  id: T;
  label: ReactNode;
}

export function GlassSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  itemClassName,
  ariaLabel,
  style,
}: {
  value: T;
  options: Array<GlassSegmentedOption<T>>;
  onChange: (value: T) => void;
  className?: string;
  itemClassName?: string;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  return (
    <GlassSurface material="regular" flat className={cn("gary-segmented", className)} role="tablist" aria-label={ariaLabel} style={style}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn("gary-segmented__item px-4 py-2 text-sm font-medium", itemClassName, value === option.id && "gary-segmented__item--active")}
        >
          {option.label}
        </button>
      ))}
    </GlassSurface>
  );
}
