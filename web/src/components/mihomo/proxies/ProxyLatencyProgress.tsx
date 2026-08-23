import { CheckCircle2, CircleX, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProxyTestProgressView } from "./types";

export function ProxyLatencyProgress({ job, onCancel }: { job: ProxyTestProgressView; onCancel?: () => void }) {
  const total = Math.max(0, job.total);
  const completed = Math.min(total, Math.max(0, job.completed));
  const percent = total ? (completed / total) * 100 : job.status === "done" ? 100 : 0;
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="rounded-2xl bg-background/55 px-3 py-2.5 text-xs" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {active ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : job.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CircleX className="h-4 w-4 text-amber-500" />}
        <span className="font-medium">{job.scope === "all" ? "全部测速" : job.scope === "group" ? "策略组测速" : job.scope === "provider" ? "供应商健康检查" : "节点测速"}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{completed}/{total} · 成功 {job.succeeded} · 失败 {job.failed}</span>
        {active && onCancel ? <button type="button" onClick={onCancel} className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="取消测速" aria-label="取消测速"><X className="h-3.5 w-3.5" /></button> : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-primary transition-[width] duration-250", job.status === "cancelled" && "bg-amber-500")} style={{ width: `${percent}%` }} /></div>
      {job.url ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{job.source ? `${job.source} · ` : ""}{job.url}{job.timeoutMs ? ` · ${job.timeoutMs}ms` : ""}</p> : null}
    </div>
  );
}
