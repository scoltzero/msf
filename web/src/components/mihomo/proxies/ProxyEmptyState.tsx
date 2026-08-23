import { Inbox, SearchX } from "lucide-react";

export function ProxyEmptyState({ kind, searching = false, onClear }: { kind: "groups" | "providers" | "nodes"; searching?: boolean; onClear?: () => void }) {
  const label = kind === "groups" ? "策略组" : kind === "providers" ? "供应商" : "节点";
  return (
    <div className="rounded-3xl bg-background/45 px-6 py-14 text-center text-muted-foreground">
      {searching ? <SearchX className="mx-auto h-8 w-8 opacity-50" /> : <Inbox className="mx-auto h-8 w-8 opacity-50" />}
      <p className="mt-3 text-sm">{searching ? `没有匹配的${label}` : `暂无${label}`}</p>
      {searching && onClear ? <button type="button" onClick={onClear} className="mt-3 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15">清空搜索</button> : null}
    </div>
  );
}
