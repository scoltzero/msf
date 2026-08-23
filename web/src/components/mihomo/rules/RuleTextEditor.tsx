import { useMemo } from "react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import type { RuleValidationIssue } from "@/features/mihomo-rules/types";

export function RuleTextEditor({ value, onChange, issues = [], readOnly = false }: { value: string; onChange: (value: string) => void; issues?: readonly RuleValidationIssue[]; readOnly?: boolean }) {
  const lines = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const lineNumbers = useMemo(() => Array.from({ length: lines }, (_, index) => index + 1).join("\n"), [lines]);
  return (
    <SolidPlate tone="regular" className="overflow-hidden p-0">
      <div className="flex min-h-[360px]">
        <pre aria-hidden="true" className="select-none border-r border-border/50 bg-muted/35 px-3 py-3 text-right font-mono text-xs leading-5 text-muted-foreground">{lineNumbers}</pre>
        <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} readOnly={readOnly} spellCheck={false} className="min-h-[360px] min-w-0 flex-1 resize-y bg-transparent px-3 py-3 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60" placeholder={"DOMAIN-SUFFIX,example.com,节点选择\nRULE-SET,ai,人工智能\nMATCH,漏网之鱼"} aria-label="一行一条规则" />
      </div>
      {issues.length ? <div className="border-t border-border/50 px-3 py-2 text-xs leading-5 text-destructive">{issues.map((issue, index) => <p key={`${issue.path ?? "issue"}-${index}`}>{issue.line ? `第 ${issue.line} 行：` : ""}{issue.message}</p>)}</div> : null}
    </SolidPlate>
  );
}
