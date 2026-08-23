"use client";

import { ShieldCheck } from "lucide-react";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { useMosdnsDashboardData } from "../../data";
import type { MosdnsWidgetSize } from "./model";

export function MosdnsResolutionPolicyWidget({ size = "m" }: { size?: MosdnsWidgetSize }) {
  const { runMode, resolutionSettings, prioritySaving, actionSaving, error, message, changeRunMode, changePriority } = useMosdnsDashboardData(["control"]);
  const priority = resolutionSettings.ipv4First ? "ipv4" : resolutionSettings.ipv6First ? "ipv6" : "auto";
  return <div className="flex h-full min-h-0 flex-col gap-4"><section><div className="mb-2 flex items-center gap-2 text-xs font-medium"><ShieldCheck className="h-4 w-4 text-primary" />运行模式</div><div className={actionSaving ? "pointer-events-none opacity-60" : ""} aria-busy={actionSaving}><GlassSegmentedControl value={runMode} onChange={(value) => void changeRunMode(value)} options={[{ id: "compatible", label: "兼容模式" }, { id: "safe", label: "安全模式" }]} ariaLabel="MosDNS 运行模式" className="grid w-full grid-cols-2" /></div>{size !== "s" ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">兼容模式优先覆盖面，安全模式采用更严格的解析链路。</p> : null}</section><section><p className="mb-2 text-xs font-medium">协议优先级</p><div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="协议优先级">{([['auto','自动'],['ipv4','IPv4 优先'],['ipv6','IPv6 优先']] as const).map(([value,label]) => <button key={value} type="button" role="radio" aria-checked={priority === value} disabled={prioritySaving} onClick={() => void changePriority(value)} className={`rounded-xl px-2 py-3 text-xs transition disabled:cursor-wait disabled:opacity-50 ${priority === value ? "bg-primary/12 font-medium text-primary" : "bg-foreground/[.035] text-muted-foreground"}`}>{label}</button>)}</div>{size !== "s" ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">自动保留实际存在的 A/AAAA；优先模式只在双栈域名中抑制另一协议。</p> : null}</section><p aria-live="polite" className={`mt-auto min-h-4 text-[10px] ${error ? "text-red-500" : "text-muted-foreground"}`}>{prioritySaving || actionSaving ? "正在保存…" : error || message}</p></div>;
}
