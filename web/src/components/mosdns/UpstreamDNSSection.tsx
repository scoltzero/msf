"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Globe } from "lucide-react";
import type { UpstreamServer, UpstreamGroup } from "@/lib/mosdns-system-data";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";

/* ─── Server row using CSS Grid (matching live site grid-cols layout) ─── */
function ServerRow({
  groupId,
  server,
  onToggle,
  onEdit,
  onDelete,
}: {
  groupId: string;
  server: UpstreamServer;
  onToggle: (groupId: string, id: string) => void;
  onEdit: (groupId: string, s: UpstreamServer) => void;
  onDelete: (groupId: string, id: string) => void;
}) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[36px_minmax(0,1fr)_auto] items-center px-1 py-1.5 transition-colors hover:bg-foreground/[0.025] @[560px]:grid-cols-[40px_minmax(120px,0.8fr)_58px_minmax(180px,1.2fr)_64px]">
      {/* Enable checkbox */}
      <div className="flex justify-center">
        <button
          role="switch"
          aria-checked={server.enabled}
          aria-label={`${server.enabled ? "禁用" : "启用"} ${server.name}`}
          onClick={() => onToggle(groupId, server.id)}
          className={cn(
            "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
            server.enabled ? "bg-emerald-500" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              server.enabled ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      {/* Name + note */}
      <div className="min-w-0 cursor-pointer px-1.5" onClick={() => onEdit(groupId, server)}>
        <div className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors">
          {server.name}
        </div>
        {server.note && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{server.note}</div>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground @[560px]:hidden">
          <span className="shrink-0 font-medium">{server.protocol.toUpperCase()}</span>
          <span className="truncate font-mono">{server.address}</span>
        </div>
      </div>
      {/* Protocol */}
      <div
        className="hidden cursor-pointer truncate px-1 text-sm text-foreground transition-colors hover:text-primary @[560px]:block"
        onClick={() => onEdit(groupId, server)}
      >
        {server.protocol.toUpperCase()}
      </div>
      {/* Address */}
      <div
        className="hidden cursor-pointer truncate px-1 font-mono text-xs text-foreground transition-colors hover:text-primary @[560px]:block"
        onClick={() => onEdit(groupId, server)}
      >
        {server.address}
      </div>
      {/* Actions — TEXT buttons, not icons */}
      <div className="flex items-center justify-end gap-0.5 px-1">
        <button
          onClick={() => onEdit(groupId, server)}
          className="whitespace-nowrap rounded px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary/80"
        >
          编辑
        </button>
        <button
          onClick={() => onDelete(groupId, server.id)}
          className="whitespace-nowrap rounded px-1.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive/80"
        >
          删除
        </button>
      </div>
    </div>
  );
}

/* ─── Upstream Group Panel ─── */
function UpstreamGroupPanel({
  group,
  onToggleGroup,
  onToggleServer,
  onEditServer,
  onDeleteServer,
  onAddServer,
  onReorderServer,
  reorderDisabled,
}: {
  group: UpstreamGroup;
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleServer: (groupId: string, serverId: string) => void;
  onEditServer: (groupId: string, s: UpstreamServer) => void;
  onDeleteServer: (groupId: string, serverId: string) => void;
  onAddServer: (groupId: string) => void;
  onReorderServer: (groupId: string, sourceId: string, targetId: string) => void;
  reorderDisabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const enabledCount = group.servers.filter((s) => s.enabled).length;
  const total = group.servers.length;
  const allEnabled = enabledCount === total && total > 0;
  const someEnabled = enabledCount > 0 && !allEnabled;

  const toggleAll = () => {
    onToggleGroup(group.id, !allEnabled);
  };

  return (
    <SolidPlate tone="subtle" className="@container overflow-hidden rounded-2xl">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="p-1 rounded bg-primary/10 text-primary">
            <Globe className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-sm text-foreground">{group.name}</span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">({group.subtitle})</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            已启用 {enabledCount}/{total}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); toggleAll(); }}
            role="switch"
            aria-checked={allEnabled || someEnabled}
            aria-label={`${allEnabled || someEnabled ? "禁用" : "启用"} ${group.name}`}
            className={cn(
              "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
              allEnabled ? "bg-emerald-500" : someEnabled ? "bg-amber-400" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                (allEnabled || someEnabled) ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddServer(group.id); }}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>
      </div>

      {/* Expanded table */}
      {expanded && (
        <div className="border-t border-border/20">
          {/* Header row */}
          <div className="ml-12 hidden grid-cols-[40px_minmax(120px,0.8fr)_58px_minmax(180px,1.2fr)_64px] items-center bg-foreground/[0.025] px-1 py-1.5 text-xs font-medium text-muted-foreground @[560px]:grid">
            <div className="text-center">启用</div>
            <div className="px-1.5">名称</div>
            <div className="px-1">协议</div>
            <div className="px-1">地址</div>
            <div className="px-1 text-right">操作</div>
          </div>
          {group.servers.map((s, index) => (
            <div
              key={s.id}
              className={cn("flex items-center rounded-lg", draggedId === s.id && "opacity-50")}
              onDragOver={(event) => {
                if (draggedId && !reorderDisabled) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                if (!draggedId || reorderDisabled) return;
                event.preventDefault();
                onReorderServer(group.id, draggedId, s.id);
                setDraggedId(null);
              }}
            >
              <div className="flex w-12 shrink-0 items-center justify-center text-muted-foreground">
                <button
                  type="button"
                  draggable={!reorderDisabled && total > 1}
                  disabled={reorderDisabled || total < 2}
                  aria-label={`拖动排序 ${s.name}`}
                  title="拖动排序，也可用上下箭头移动"
                  className="flex h-8 w-6 cursor-grab items-center justify-center rounded hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-30 active:cursor-grabbing"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", s.id);
                    setDraggedId(s.id);
                  }}
                  onDragEnd={() => setDraggedId(null)}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
                <div className="flex flex-col">
                  <button type="button" aria-label={`上移 ${s.name}`} title="上移" disabled={reorderDisabled || index === 0} onClick={() => onReorderServer(group.id, s.id, group.servers[index - 1].id)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={`下移 ${s.name}`} title="下移" disabled={reorderDisabled || index === total - 1} onClick={() => onReorderServer(group.id, s.id, group.servers[index + 1].id)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ServerRow groupId={group.id} server={s} onToggle={onToggleServer} onEdit={onEditServer} onDelete={onDeleteServer} />
            </div>
          ))}
        </div>
      )}
    </SolidPlate>
  );
}

/* ─── FakeIP Sub-section (purple border-top, 2-col grid children) ─── */
function FakeIPSubSection({
  groups,
  onToggleGroup,
  onToggleServer,
  onEditServer,
  onDeleteServer,
  onAddServer,
  onReorderServer,
  reorderDisabled,
}: {
  groups: UpstreamGroup[];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleServer: (groupId: string, serverId: string) => void;
  onEditServer: (groupId: string, s: UpstreamServer) => void;
  onDeleteServer: (groupId: string, serverId: string) => void;
  onAddServer: (groupId: string) => void;
  onReorderServer: (groupId: string, sourceId: string, targetId: string) => void;
  reorderDisabled?: boolean;
}) {
  return (
    <div className="mt-3 space-y-2.5 pt-1">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-semibold text-foreground">
          FakeIP 上游
        </span>
        <span className="text-xs text-muted-foreground">分流与路由专用</span>
      </div>
      {/* Two-column grid for the sub-groups */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((group) => (
          <UpstreamGroupPanel
            key={group.id}
            group={group}
            onToggleGroup={onToggleGroup}
            onToggleServer={onToggleServer}
            onEditServer={onEditServer}
            onDeleteServer={onDeleteServer}
            onAddServer={onAddServer}
            onReorderServer={onReorderServer}
            reorderDisabled={reorderDisabled}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Main upstream DNS section ─── */
interface UpstreamDNSSectionProps {
  regularGroups: UpstreamGroup[];
  fakeIPGroups: UpstreamGroup[];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleServer: (groupId: string, serverId: string) => void;
  onEditServer: (groupId: string, s: UpstreamServer) => void;
  onDeleteServer: (groupId: string, serverId: string) => void;
  onAddServer: (groupId: string) => void;
  onReorderServer: (groupId: string, sourceId: string, targetId: string) => void;
  reorderDisabled?: boolean;
}

export function UpstreamDNSSection({
  regularGroups,
  fakeIPGroups,
  onToggleGroup,
  onToggleServer,
  onEditServer,
  onDeleteServer,
  onAddServer,
  onReorderServer,
  reorderDisabled,
}: UpstreamDNSSectionProps) {
  return (
    <GlassSurface material="thick" className="rounded-2xl">
        {/* Section header */}
        <div className="flex flex-col space-y-1.5 p-4 pb-2">
          <div className="flex items-center gap-2">
            <SolidPlate tone="subtle" className="flex h-8 w-8 items-center justify-center rounded-lg text-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.5a.5.5 0 0 1 .86.44L11 12h-2a1 1 0 0 0-.78 1.63l4.5 5.5a.5.5 0 0 0 .86-.44L12 14h-2Z" />
              </svg>
            </SolidPlate>
            <h3 className="text-base font-semibold tracking-tight">上游 DNS 设置</h3>
          </div>
          <p className="text-xs text-muted-foreground">拖动或用上下箭头排序，顺序自动保存；点击「保存并重启」应用。列表顺序不代表主备优先级。</p>
        </div>
        <div className="space-y-2.5 p-4 pt-1">
          {/* Regular upstream groups */}
          {regularGroups.map((group) => (
            <UpstreamGroupPanel
              key={group.id}
              group={group}
              onToggleGroup={onToggleGroup}
              onToggleServer={onToggleServer}
              onEditServer={onEditServer}
              onDeleteServer={onDeleteServer}
              onAddServer={onAddServer}
              onReorderServer={onReorderServer}
              reorderDisabled={reorderDisabled}
            />
          ))}

          {/* FakeIP subsection with purple separator */}
          <FakeIPSubSection
            groups={fakeIPGroups}
            onToggleGroup={onToggleGroup}
            onToggleServer={onToggleServer}
            onEditServer={onEditServer}
            onDeleteServer={onDeleteServer}
            onAddServer={onAddServer}
            onReorderServer={onReorderServer}
            reorderDisabled={reorderDisabled}
          />
        </div>
    </GlassSurface>
  );
}
