import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { deepMergeJsonObject } from "@/features/mihomo-rules/configDraft";
import type { JsonObject, RuleProviderDraft } from "@/features/mihomo-rules/types";

function valueText(value: unknown): string { return value == null ? "" : String(value); }

export function createEmptyProviderDraft(): RuleProviderDraft {
  return { name: "", value: { type: "http", behavior: "classical" } };
}

export function RuleProviderEditor({ draft, onChange, onDelete }: { draft: RuleProviderDraft; onChange: (next: RuleProviderDraft) => void; onDelete: () => void }) {
  const [advancedError, setAdvancedError] = useState<string>();
  const value = draft.value;
  const advancedText = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const setField = (key: string, next: string | number | boolean | undefined) => {
    const patch: JsonObject = next === undefined || next === "" ? {} : { [key]: next };
    const merged = next === undefined || next === "" ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as JsonObject : deepMergeJsonObject(value, patch);
    onChange({ name: key === "name" ? String(next ?? "") : draft.name, value: merged });
  };
  const setAdvanced = (text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("高级字段必须是 JSON 对象");
      setAdvancedError(undefined);
      onChange({ name: draft.name, value: parsed as JsonObject });
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : "高级 JSON 无效");
    }
  };
  return (
    <SolidPlate tone="subtle" className="p-3">
      <div className="flex items-center gap-2">
        <GlassField value={draft.name} onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })} className="h-9 min-w-0 flex-1 text-sm" placeholder="规则提供商名称" aria-label="规则提供商名称" />
        <GlassButton type="button" variant="danger" onClick={onDelete} aria-label={`删除规则提供商 ${draft.name || "未命名"}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></GlassButton>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-muted-foreground">type<select value={valueText(value.type || "http")} onChange={(event) => setField("type", event.currentTarget.value)} className="gary-field mt-1 h-9 w-full px-2 text-sm"><option value="http">http</option><option value="file">file</option><option value="inline">inline</option></select></label>
        <label className="text-xs text-muted-foreground">behavior<select value={valueText(value.behavior || "classical")} onChange={(event) => setField("behavior", event.currentTarget.value)} className="gary-field mt-1 h-9 w-full px-2 text-sm"><option value="classical">classical</option><option value="domain">domain</option><option value="ipcidr">ipcidr</option></select></label>
        <label className="text-xs text-muted-foreground">format<input value={valueText(value.format)} onChange={(event) => setField("format", event.currentTarget.value)} className="gary-field mt-1 h-9 w-full px-2 text-sm" placeholder="yaml / text" /></label>
        <label className="text-xs text-muted-foreground">interval<input type="number" min="0" value={valueText(value.interval)} onChange={(event) => setField("interval", event.currentTarget.value ? Number(event.currentTarget.value) : undefined)} className="gary-field mt-1 h-9 w-full px-2 text-sm" /></label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">URL<input value={valueText(value.url)} onChange={(event) => setField("url", event.currentTarget.value)} className="gary-field mt-1 h-9 w-full px-2 font-mono text-xs" placeholder="https://…" /></label>
        <label className="text-xs text-muted-foreground">path<input value={valueText(value.path)} onChange={(event) => setField("path", event.currentTarget.value)} className="gary-field mt-1 h-9 w-full px-2 font-mono text-xs" placeholder="./rules/name.yaml" /></label>
      </div>
      <label className="mt-2 block text-xs text-muted-foreground">高级 JSON（未展示字段会保留）<textarea value={advancedText} onChange={(event) => setAdvanced(event.currentTarget.value)} spellCheck={false} className="gary-field mt-1 min-h-28 w-full resize-y px-2 py-1.5 font-mono text-xs leading-5" aria-label="规则提供商高级 JSON" /></label>
      {advancedError ? <p className="mt-1 text-xs text-destructive" role="alert">{advancedError}</p> : null}
    </SolidPlate>
  );
}

export function AddRuleProviderButton({ onClick }: { onClick: () => void }) {
  return <GlassButton type="button" variant="tool" onClick={onClick}><Plus className="h-4 w-4" aria-hidden="true" />新增规则提供商</GlassButton>;
}
