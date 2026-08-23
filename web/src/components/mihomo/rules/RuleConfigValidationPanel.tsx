import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import type { RuleValidationResult } from "@/features/mihomo-rules/types";

export function RuleConfigValidationPanel({ result, validating }: { result?: RuleValidationResult; validating: boolean }) {
  if (validating) return <SolidPlate tone="subtle" className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在校验候选配置，不会写入或重启…</SolidPlate>;
  if (!result) return null;
  const valid = result.valid && !result.issues.some((issue) => issue.severity === "error");
  return <SolidPlate tone="subtle" className={valid ? "p-3 text-xs text-emerald-700 dark:text-emerald-300" : "p-3 text-xs text-destructive"}>{valid ? <CheckCircle2 className="mr-1.5 inline h-4 w-4" aria-hidden="true" /> : <CircleAlert className="mr-1.5 inline h-4 w-4" aria-hidden="true" />}{result.message || (valid ? "配置校验通过，可保存" : "配置校验失败，未写入")}{result.issues.length ? <ul className="mt-2 space-y-1 pl-5 list-disc">{result.issues.map((issue, index) => <li key={`${issue.path ?? "issue"}-${index}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</li>)}</ul> : null}</SolidPlate>;
}
