import { LockKeyhole, PencilLine } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { configModeDescription, configModeLabel } from "@/features/mihomo-rules/configAuthority";
import type { RuleConfigAuthority } from "@/features/mihomo-rules/types";

export function RuleConfigStatus({ authority, dirty }: { authority: RuleConfigAuthority; dirty: boolean }) {
  const editable = authority.mode === "custom" && authority.canEditRules && authority.canEditRuleProviders;
  return <SolidPlate tone="subtle" className="flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-xs"><span className="flex items-center gap-1 font-medium text-foreground">{editable ? <PencilLine className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}{configModeLabel(authority)}</span><span className="text-muted-foreground">{editable ? configModeDescription(authority) : "默认配置只读；请在配置管理中应用自定义配置后再编辑"}</span>{dirty ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">有未保存修改</span> : null}</SolidPlate>;
}
