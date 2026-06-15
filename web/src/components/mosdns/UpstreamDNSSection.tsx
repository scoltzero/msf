"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Globe } from "lucide-react";
import type { UpstreamServer, UpstreamGroup } from "@/lib/mosdns-system-data";
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
    <div className="grid grid-cols-[40px_1fr_80px_1fr_80px] items-center px-2 py-2.5 border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
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
      <div className="min-w-0 px-2 cursor-pointer" onClick={() => onEdit(groupId, server)}>
        <div className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors">
          {server.name}
        </div>
        {server.note && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{server.note}</div>
        )}
      </div>
      {/* Protocol */}
      <div
        className="px-2 text-sm text-foreground cursor-pointer hover:text-primary transition-colors truncate"
        onClick={() => onEdit(groupId, server)}
      >
        {server.protocol.toUpperCase()}
      </div>
      {/* Address */}
      <div
        className="px-2 font-mono text-xs text-foreground truncate cursor-pointer hover:text-primary transition-colors"
        onClick={() => onEdit(groupId, server)}
      >
        {server.address}
      </div>
      {/* Actions — TEXT buttons, not icons */}
      <div className="flex items-center justify-end gap-1 px-2">
        <button
          onClick={() => onEdit(groupId, server)}
          className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded hover:bg-primary/10 transition-colors"
        >
          编辑
        </button>
        <button
          onClick={() => onDelete(groupId, server.id)}
          className="text-xs text-destructive hover:text-destructive/80 font-medium px-2 py-1 rounded hover:bg-destructive/10 transition-colors"
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
}: {
  group: UpstreamGroup;
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleServer: (groupId: string, serverId: string) => void;
  onEditServer: (groupId: string, s: UpstreamServer) => void;
  onDeleteServer: (groupId: string, serverId: string) => void;
  onAddServer: (groupId: string) => void;
}) {
  const [expanded, setExpanded] = useState(group.defaultExpanded);

  const enabledCount = group.servers.filter((s) => s.enabled).length;
  const total = group.servers.length;
  const allEnabled = enabledCount === total && total > 0;
  const someEnabled = enabledCount > 0 && !allEnabled;

  const toggleAll = () => {
    onToggleGroup(group.id, !allEnabled);
  };

  return (
    <div className="rounded-xl border border-border/30 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
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
          <span className="text-xs text-muted-foreground">({group.subtitle})</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
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
            className="flex items-center gap-1 text-primary text-sm font-medium hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>
      </div>

      {/* Expanded table */}
      {expanded && (
        <div>
          {/* Header row */}
          <div className="grid grid-cols-[40px_1fr_80px_1fr_80px] items-center px-2 py-2 text-xs font-medium text-muted-foreground border-b border-border/20 bg-muted/10">
            <div className="text-center">启用</div>
            <div className="px-2">名称</div>
            <div className="px-2">协议</div>
            <div className="px-2">地址</div>
            <div className="text-right px-2">操作</div>
          </div>
          {group.servers.map((s) => (
            <ServerRow
              key={s.id}
              groupId={group.id}
              server={s}
              onToggle={onToggleServer}
              onEdit={onEditServer}
              onDelete={onDeleteServer}
            />
          ))}
        </div>
      )}
    </div>
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
}: {
  groups: UpstreamGroup[];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleServer: (groupId: string, serverId: string) => void;
  onEditServer: (groupId: string, s: UpstreamServer) => void;
  onDeleteServer: (groupId: string, serverId: string) => void;
  onAddServer: (groupId: string) => void;
}) {
  return (
    <div className="mt-6 pt-4 border-t-2 border-purple-200/40">
      {/* Section title — purple text, no icon container */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
          FakeIP 上游
        </span>
        <span className="text-xs text-muted-foreground">分流与路由专用</span>
      </div>
      {/* Two-column grid for the sub-groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groups.map((group) => (
          <div
            key={group.id}
            className="rounded-lg border-2 border-purple-200/60 bg-gradient-to-br from-purple-50/30 to-transparent dark:from-purple-950/20 shadow-sm"
          >
            <UpstreamGroupPanel
              group={group}
              onToggleGroup={onToggleGroup}
              onToggleServer={onToggleServer}
              onEditServer={onEditServer}
              onDeleteServer={onDeleteServer}
              onAddServer={onAddServer}
            />
          </div>
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
}

export function UpstreamDNSSection({
  regularGroups,
  fakeIPGroups,
  onToggleGroup,
  onToggleServer,
  onEditServer,
  onDeleteServer,
  onAddServer,
}: UpstreamDNSSectionProps) {
  return (
    <div className="mb-6">
      <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 !shadow-none transition-shadow duration-300 hover:!shadow-sm border-cyan-200/40 shadow-sm">
        {/* Section header */}
        <div className="flex flex-col space-y-1.5 p-6 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.6 0.12 190)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.5a.5.5 0 0 1 .86.44L11 12h-2a1 1 0 0 0-.78 1.63l4.5 5.5a.5.5 0 0 0 .86-.44L12 14h-2Z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold tracking-tight">上游 DNS 设置</h3>
          </div>
          <p className="text-xs text-muted-foreground">直接编辑 upstream_overrides.json</p>
        </div>
        <div className="p-6 pt-0 space-y-3">
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
          />
        </div>
      </div>
    </div>
  );
}
