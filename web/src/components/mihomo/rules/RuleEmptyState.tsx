import { Info } from "lucide-react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";

export function RuleEmptyState({ title, description, loading = false }: { title: string; description?: string; loading?: boolean }) {
  return (
    <GlassSurface material="thick" className="flex min-h-40 flex-col items-center justify-center px-5 py-10 text-center">
      <Info className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">{loading ? "正在加载…" : title}</p>
      {description ? <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </GlassSurface>
  );
}
