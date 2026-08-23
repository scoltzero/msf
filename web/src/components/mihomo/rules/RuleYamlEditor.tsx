import { AlertTriangle } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { checkYamlSafety } from "@/features/mihomo-rules/yamlSafety";

export function RuleYamlEditor({ value, onChange, readOnly = false }: { value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  const safety = checkYamlSafety(value);
  return (
    <div>
      <SolidPlate tone="regular" className="p-0">
        <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} readOnly={readOnly} spellCheck={false} className="min-h-[460px] w-full resize-y bg-transparent px-3 py-3 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60" placeholder="在此编辑完整 YAML；锚点、别名和 merge key 会在 YAML 模式中保留。" aria-label="规则配置 YAML" />
      </SolidPlate>
      {!safety.safe ? <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />检测到 {safety.features.join("、")}；结构化表单保存已禁用，请继续使用 YAML 编辑模式。</p> : null}
    </div>
  );
}
