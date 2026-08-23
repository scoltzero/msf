import { AlertTriangle, ArrowDown, GitBranch, X } from "lucide-react";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import type { ProxyChainView } from "./types";

export function ProxyChainDialog({ open, groupName, chain, onClose }: { open: boolean; groupName?: string; chain?: ProxyChainView; onClose: () => void }) {
  if (!open || !chain) return null;
  return (
    <ModalViewport onClose={onClose}>
      <GlassDialog className="w-full max-w-lg p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-border/45 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><GitBranch className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">节点链路</h2><p className="mt-1 truncate text-xs text-muted-foreground">{groupName || "当前策略组"}</p></div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background/45 text-muted-foreground hover:text-foreground" title="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 px-5 py-5">
          {chain.path.length ? chain.path.map((name, index) => <div key={`${name}-${index}`} className="flex items-center gap-2"><div className="min-w-0 flex-1 rounded-xl bg-background/55 px-3 py-2 text-sm"><span className="mr-2 text-xs tabular-nums text-muted-foreground">{index + 1}</span>{name}</div>{index < chain.path.length - 1 ? <ArrowDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}</div>) : <p className="text-sm text-muted-foreground">没有解析到链路。</p>}
          {chain.finalKey ? <div className="rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">最终出口：<b>{chain.finalKey}</b></div> : null}
          {chain.cycleDetected || chain.missing?.length ? <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{chain.cycleDetected ? "检测到循环引用，已停止继续解析。" : `存在失效引用：${chain.missing?.join("、")}`}</span></div> : null}
        </div>
      </GlassDialog>
    </ModalViewport>
  );
}
