import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";

export function ProxyEditorShell({
  open,
  title,
  description,
  dirty,
  saving,
  validating,
  validationMessage,
  onClose,
  onValidate,
  onSave,
  disabled = false,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  dirty: boolean;
  saving?: boolean;
  validating?: boolean;
  validationMessage?: string;
  onClose: () => void;
  onValidate: () => void;
  onSave: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  const requestClose = () => {
    if (!dirty || window.confirm("草稿尚未保存，确认关闭吗？")) onClose();
  };
  return (
    <ModalViewport onClose={requestClose}>
      <GlassDialog className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-border/45 px-5 py-4"><div className="min-w-0 flex-1"><h2 className="text-base font-semibold">{title}{dirty ? <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-300">· 未保存</span> : null}</h2>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</div><button type="button" onClick={requestClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background/45 text-muted-foreground hover:text-foreground" title="关闭"><X className="h-4 w-4" /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {validationMessage ? <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{validationMessage}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/45 px-5 py-3"><p className="text-[11px] text-muted-foreground">保存会自动复验候选配置；校验不会写入或重启。</p><div className="flex items-center gap-2"><button type="button" onClick={onValidate} disabled={disabled || validating || saving} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-background/50 px-3 text-xs font-medium text-foreground hover:bg-background/75 disabled:opacity-50">{validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}校验配置</button><button type="button" onClick={onSave} disabled={disabled || saving || validating} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}保存并重启</button></div></div>
      </GlassDialog>
    </ModalViewport>
  );
}
