"use client";

import { useState } from "react";
import { Plus, RefreshCw, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  routingTypes,
  type SubscriptionRule,
  type RoutingRule,
} from "@/lib/mosdns-rules-data";

export type RuleSetRow = (SubscriptionRule | RoutingRule) & {
  id: string;
  type?: string;
  sourceType?: string;
  files?: string;
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-10 flex-shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

const cardCls =
  "rounded-[12px] border bg-card text-card-foreground !border-border/20 overflow-hidden";
const headColCls =
  "grid items-center px-4 py-2 bg-muted/40 text-xs font-medium text-muted-foreground border-b border-border/30";
const rowCls =
  "group grid items-center px-4 py-2.5 border-b border-border/20 last:border-0 hover:bg-muted/40 transition-colors";
const primaryBtn =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors";
const outlineBtn =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-background text-sm font-medium text-foreground hover:bg-accent transition-colors";
const switchCellCls = "flex items-center justify-center";

function RowActions({
  onEdit,
  onUpdate,
  onDelete,
}: {
  onEdit: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={onUpdate} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <button onClick={onEdit} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDelete} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AdblockView({
  onToast,
  lists,
  onToggle,
  onUpdate,
  onDelete,
  onEdit,
  onAdd,
  onUpdateAll,
}: {
  onToast: (m: string) => void;
  lists: RuleSetRow[];
  onToggle: (item: RuleSetRow) => void;
  onUpdate: (item: RuleSetRow) => void;
  onDelete: (item: RuleSetRow) => void;
  onEdit: (item: RuleSetRow) => void;
  onAdd: (sourceType: "adguard" | "srs") => void;
  onUpdateAll: (sourceType: "adguard" | "srs") => void;
}) {
  const GRID = "grid-cols-[60px_150px_1fr_100px_180px_120px]";

  return (
    <div className="animate-fade-in space-y-4">
      <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          共 <span className="font-bold text-foreground">{lists.length}</span> 条规则
        </span>
        <div className="flex gap-2">
          <button onClick={() => onAdd("adguard")} className={primaryBtn}>
            <Plus className="h-4 w-4" />添加规则
          </button>
          <button onClick={() => onUpdateAll("adguard")} className={outlineBtn}>
            <RefreshCw className="h-4 w-4" />检查更新
          </button>
        </div>
      </div>

      <div className={cardCls}>
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="font-semibold tracking-tight text-foreground text-base">
            广告拦截规则
          </h3>
        </div>
        <div className={cn(headColCls, GRID)}>
          <span className="text-center">启用</span>
          <span>名称</span>
          <span>清单网址</span>
          <span>规则数</span>
          <span>上次更新</span>
          <span className="text-right">操作</span>
        </div>
        {lists.map((r) => (
          <div key={r.id} className={cn(rowCls, GRID)}>
            <div className={switchCellCls}>
              <Toggle checked={r.enabled} onChange={() => onToggle(r)} />
            </div>
            <span className="font-medium text-foreground truncate">{r.name}</span>
            <span
              className="font-mono text-xs text-muted-foreground truncate pr-3"
              title={r.url}
            >
              {r.url}
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {r.ruleCount}
            </span>
            <span className="text-xs text-muted-foreground">{r.updatedAt}</span>
            <RowActions onEdit={() => onEdit(r)} onUpdate={() => onUpdate(r)} onDelete={() => onDelete(r)} />
          </div>
        ))}
        {lists.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无广告拦截规则源</div>
        )}
      </div>
    </div>
  );
}

const badgeColor: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

export function RoutingView({
  onToast,
  lists,
  onToggle,
  onUpdate,
  onDelete,
  onEdit,
  onAdd,
  onUpdateAll,
}: {
  onToast: (m: string) => void;
  lists: RuleSetRow[];
  onToggle: (item: RuleSetRow) => void;
  onUpdate: (item: RuleSetRow) => void;
  onDelete: (item: RuleSetRow) => void;
  onEdit: (item: RuleSetRow) => void;
  onAdd: (sourceType: "adguard" | "srs") => void;
  onUpdateAll: (sourceType: "adguard" | "srs") => void;
}) {
  const [filter, setFilter] = useState("all");
  const visible =
    filter === "all" ? lists : lists.filter((r) => "typeKey" in r && r.typeKey === filter);
  const GRID = "grid-cols-[60px_180px_150px_1fr_100px_180px_140px]";

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
        <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>
          <span className="font-semibold">注意:</span> 请勿随意删除或禁用系统默认的分流规则!
        </span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">
            共 <span className="font-bold text-foreground">{lists.length}</span> 条规则
          </span>
          <div className="flex gap-2">
            <button onClick={() => onUpdateAll("srs")} className={outlineBtn}>
              <RefreshCw className="h-4 w-4" />全部更新
            </button>
            <button onClick={() => onAdd("srs")} className={primaryBtn}>
              <Plus className="h-4 w-4" />添加规则
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {routingTypes.map((t) => {
            const active = t.key === filter;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  "px-3 py-1.5 rounded-lg border transition-colors text-xs font-medium whitespace-nowrap",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={cardCls}>
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="font-semibold tracking-tight text-foreground text-base">
            在线分流规则
          </h3>
        </div>
        <div className={cn(headColCls, GRID)}>
          <span className="text-center">启用</span>
          <span>类型</span>
          <span>名称</span>
          <span>清单网址</span>
          <span>规则数</span>
          <span>上次更新</span>
          <span className="text-right">操作</span>
        </div>
        {visible.map((r) => (
          <div key={r.id} className={cn(rowCls, GRID)}>
            <div className={switchCellCls}>
              <Toggle checked={r.enabled} onChange={() => onToggle(r)} />
            </div>
            <span>
              <span
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                  "color" in r ? badgeColor[r.color] : badgeColor.blue
                )}
              >
                {"typeLabel" in r ? r.typeLabel : r.type || "规则"}
              </span>
            </span>
            <span className="font-medium text-foreground truncate">{r.name}</span>
            <span
              className="font-mono text-xs text-muted-foreground truncate pr-3"
              title={r.url}
            >
              {r.url}
            </span>
            <span className="font-semibold text-foreground tabular-nums">
              {r.ruleCount}
            </span>
            <span className="text-xs text-muted-foreground">{r.updatedAt}</span>
            <RowActions onEdit={() => onEdit(r)} onUpdate={() => onUpdate(r)} onDelete={() => onDelete(r)} />
          </div>
        ))}
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无在线分流规则源</div>
        )}
      </div>
    </div>
  );
}
