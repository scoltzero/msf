"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FolderKanban, Layers3, Loader2, LockKeyhole, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassDialog } from "@/components/liquid-glass/GlassDialog";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";

export type ProxyCollectionKind = "group" | "provider";

export type ProxyCollectionItem = {
  /** A stable key is optional; names remain a valid fallback for simple callers. */
  id?: string;
  name: string;
  subtitle?: ReactNode;
  readOnly?: boolean;
  /** Generated rows are treated as read-only even when readOnly was omitted. */
  generated?: boolean;
  readOnlyReason?: string;
};

export type ProxyCollectionManagerDialogProps = {
  open: boolean;
  kind: ProxyCollectionKind;
  items: readonly ProxyCollectionItem[];
  canCreate?: boolean;
  onClose: () => void;
  onCreate?: () => void;
  onEdit?: (item: ProxyCollectionItem) => void;
  onDelete?: (item: ProxyCollectionItem) => Promise<void> | void;
};

type ConfirmState = {
  item: ProxyCollectionItem;
  key: string;
};

function itemKey(item: ProxyCollectionItem, index: number) {
  return item.id || `${item.name}-${index}`;
}

function kindCopy(kind: ProxyCollectionKind) {
  return kind === "group"
    ? {
        title: "策略组管理",
        noun: "策略组",
        icon: FolderKanban,
        impact: "删除后该策略组及其路由选择会从配置中移除，引用它的规则可能无法继续使用。",
        readOnlyReason: "该策略组由默认/生成配置管理，不能编辑或删除。",
      }
    : {
        title: "订阅 Provider 管理",
        noun: "Provider",
        icon: Layers3,
        impact: "删除后该 Provider 的订阅配置与节点列表将移除，依赖它的策略组将失去这些节点。",
        readOnlyReason: "该 Provider 由默认/生成配置管理，不能编辑或删除。",
      };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error && reason.message.trim() ? reason.message : "删除失败，请稍后重试。";
}

export function ProxyCollectionManagerDialog({
  open,
  kind,
  items,
  canCreate = false,
  onClose,
  onCreate,
  onEdit,
  onDelete,
}: ProxyCollectionManagerDialogProps) {
  const copy = kindCopy(kind);
  const Icon = copy.icon;
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirm(null);
      setDeleteError("");
      setDeleting(false);
    }
  }, [open]);

  const visibleConfirm = useMemo(() => {
    if (!confirm) return null;
    return items.some((item, index) => itemKey(item, index) === confirm.key) ? confirm : null;
  }, [confirm, items]);

  useEffect(() => {
    if (confirm && !visibleConfirm) {
      setConfirm(null);
      setDeleteError("");
    }
  }, [confirm, visibleConfirm]);

  if (!open) return null;

  const requestDelete = (item: ProxyCollectionItem, key: string) => {
    setDeleteError("");
    setConfirm({ item, key });
  };

  const cancelDelete = () => {
    if (deleting) return;
    setConfirm(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!visibleConfirm || !onDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(visibleConfirm.item);
      setConfirm(null);
    } catch (reason) {
      // Keep the confirmation state visible so a transient API failure cannot
      // turn an unconfirmed destructive action into a silent no-op.
      setDeleteError(errorMessage(reason));
    } finally {
      setDeleting(false);
    }
  };

  const readOnlyReason = (item: ProxyCollectionItem) => item.readOnlyReason || copy.readOnlyReason;

  return (
    <ModalViewport onClose={onClose}>
      <GlassDialog
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
      >
        {visibleConfirm ? (
          <>
            <div className="flex items-start gap-3 border-b border-border/45 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <TriangleAlert className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">删除{copy.noun}</h2>
                <p className="mt-1 text-xs text-muted-foreground">删除前请确认影响范围。</p>
              </div>
              <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background/45 text-muted-foreground hover:text-foreground" title="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-5">
              <GlassSurface material="regular" flat className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
                <p className="text-sm font-semibold text-foreground">
                  确认删除「<span className="break-all">{visibleConfirm.item.name}</span>」吗？
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.impact}</p>
              </GlassSurface>
              {deleteError ? <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{deleteError}</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/45 px-5 py-3">
              <GlassButton type="button" onClick={cancelDelete} disabled={deleting} className="h-9 px-3 text-xs">返回列表</GlassButton>
              <GlassButton type="button" variant="danger" onClick={() => void confirmDelete()} disabled={deleting || !onDelete} className="h-9 px-3 text-xs">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {deleting ? "删除中…" : "确认删除"}
              </GlassButton>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-border/45 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{copy.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">查看、编辑或移除当前可管理的{copy.noun}。</p>
              </div>
              <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background/45 text-muted-foreground hover:text-foreground" title="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-5">
              {items.length === 0 ? <p className="rounded-2xl bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">暂无可管理的{copy.noun}。</p> : null}
              {items.map((item, index) => {
                const key = itemKey(item, index);
                const locked = Boolean(item.readOnly || item.generated);
                const reason = readOnlyReason(item);
                return (
                  <GlassSurface key={key} material="regular" flat className="flex items-center gap-3 rounded-2xl border border-border/35 bg-background/35 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-foreground" title={item.name}>{item.name}</p>
                        {locked ? <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={reason}><LockKeyhole className="h-3 w-3" />只读</span> : null}
                      </div>
                      {item.subtitle ? <p className="mt-1 truncate text-xs text-muted-foreground" title={typeof item.subtitle === "string" ? item.subtitle : undefined}>{item.subtitle}</p> : null}
                      {locked ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{reason}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <GlassButton type="button" variant="tool" onClick={() => onEdit?.(item)} disabled={locked || !onEdit} title={locked ? reason : `编辑${item.name}`} aria-label={locked ? `${item.name} 为只读项目` : `编辑 ${item.name}`} className="h-8 px-2.5 text-xs">
                        <Pencil className="h-3.5 w-3.5" />编辑
                      </GlassButton>
                      <GlassButton type="button" variant="danger" onClick={() => requestDelete(item, key)} disabled={locked || !onDelete} title={locked ? reason : `删除${item.name}`} aria-label={locked ? `${item.name} 为只读项目，不能删除` : `删除 ${item.name}`} className="h-8 px-2.5 text-xs">
                        <Trash2 className="h-3.5 w-3.5" />删除
                      </GlassButton>
                    </div>
                  </GlassSurface>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border/45 px-5 py-3">
              <p className="text-[11px] text-muted-foreground">{canCreate ? `可新建${copy.noun}。` : `当前权限不允许新建${copy.noun}。`}</p>
              <div className="flex items-center gap-2">
                <GlassButton type="button" onClick={onClose} className="h-9 px-3 text-xs">关闭</GlassButton>
                {onCreate ? <GlassButton type="button" variant="primary" onClick={onCreate} disabled={!canCreate} title={canCreate ? `新建${copy.noun}` : `当前权限不允许新建${copy.noun}`} className="h-9 px-3 text-xs"><Plus className="h-3.5 w-3.5" />新建</GlassButton> : null}
              </div>
            </div>
          </>
        )}
      </GlassDialog>
    </ModalViewport>
  );
}

export default ProxyCollectionManagerDialog;
