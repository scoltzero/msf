"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { GlassSegmentedControl } from "@/components/liquid-glass/GlassSegmentedControl";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";

export type DashboardCollectionOption<T extends string> = { id: T; label: ReactNode; pickerLabel?: string };

export function DashboardCollectionHeaderControl<T extends string>({
  options,
  selected,
  active,
  onSelectedChange,
  onActiveChange,
  ariaLabel,
}: {
  options: readonly DashboardCollectionOption<T>[];
  selected: readonly T[];
  active: T;
  onSelectedChange: (pages: T[]) => void;
  onActiveChange: (page: T) => void;
  ariaLabel: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [configuring, setConfiguring] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ left: 12, top: 72, width: 280 });
  const visible = options.filter((option) => selected.includes(option.id));

  const positionPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const top = below + 190 <= window.innerHeight ? below : Math.max(12, rect.top - 190);
    setPanelPosition({ left, top, width });
  };

  useEffect(() => {
    if (!configuring) return;
    positionPanel();
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const reposition = () => positionPanel();
    const handleKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setConfiguring(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel.contains(document.activeElement) || !focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [configuring]);

  const toggle = (id: T) => {
    const next = selected.includes(id)
      ? selected.filter((page) => page !== id)
      : options.filter((option) => selected.includes(option.id) || option.id === id).map((option) => option.id);
    if (!next.length) return;
    onSelectedChange(next);
    if (!next.includes(active)) onActiveChange(next[0]);
  };

  const configPanel = configuring && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[80] bg-black/10" onPointerDown={(event) => { if (event.currentTarget === event.target) setConfiguring(false); }}>
      <GlassSurface ref={panelRef} tabIndex={-1} material="regular" strong role="dialog" aria-modal="true" aria-label={`${ariaLabel}内容设置`} className="!fixed space-y-3 rounded-2xl p-3 shadow-2xl outline-none" style={panelPosition}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">选择集合内容</p><p className="text-[10px] text-muted-foreground">至少保留一项，已选内容在标题栏切换</p></div>
          <button type="button" onClick={() => setConfiguring(false)} aria-label="关闭集合设置" className="gary-icon-button h-8 w-8 rounded-lg"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={`${ariaLabel}可见页面`}>
          {options.map((option) => {
            const enabled = selected.includes(option.id);
            const lastSelected = enabled && selected.length === 1;
            return <button key={option.id} type="button" aria-pressed={enabled} disabled={lastSelected} onClick={() => toggle(option.id)} className={cn("flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-[background-color,color] disabled:cursor-not-allowed", enabled ? "bg-primary/12 text-primary" : "bg-foreground/[.045] text-muted-foreground hover:text-foreground", lastSelected && "opacity-70")}><Check className={cn("h-3.5 w-3.5 shrink-0", !enabled && "opacity-0")} /><span className="truncate">{option.pickerLabel ?? option.label}</span></button>;
          })}
        </div>
      </GlassSurface>
    </div>,
    document.body,
  ) : null;

  return <>
    <div className="flex items-center gap-1">
      <select aria-label={ariaLabel} value={active} onChange={(event) => onActiveChange(event.target.value as T)} className="gary-field h-8 max-w-28 rounded-lg pl-2 pr-7 text-[11px] sm:max-w-36">
        {visible.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <button ref={triggerRef} type="button" onClick={() => setConfiguring((value) => !value)} aria-expanded={configuring} aria-label="选择集合内容" className={cn("gary-icon-button h-8 w-8 rounded-lg", configuring && "text-primary")}><SlidersHorizontal className="h-3.5 w-3.5" /></button>
    </div>
    {configPanel}
  </>;
}

export function DashboardCollectionTabs<T extends string>({
  options,
  selected,
  active,
  onSelectedChange,
  onActiveChange,
  ariaLabel,
}: {
  options: readonly DashboardCollectionOption<T>[];
  selected: readonly T[];
  active: T;
  onSelectedChange?: (pages: T[]) => void;
  onActiveChange: (page: T) => void;
  ariaLabel: string;
}) {
  const [configuring, setConfiguring] = useState(false);
  const visible = options.filter((option) => selected.includes(option.id));
  const toggle = (id: T) => {
    if (!onSelectedChange) return;
    const next = selected.includes(id) ? selected.filter((page) => page !== id) : options.filter((option) => selected.includes(option.id) || option.id === id).map((option) => option.id);
    if (!next.length) return;
    onSelectedChange(next);
    if (!next.includes(active)) onActiveChange(next[0]);
  };

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {visible.length > 1 ? (
          <GlassSegmentedControl value={active} onChange={onActiveChange} options={visible.map(({ id, label }) => ({ id, label }))} ariaLabel={ariaLabel} className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }} />
        ) : (
          <SolidPlate tone="subtle" className="min-w-0 flex-1 px-3 py-2 text-xs font-medium">{visible[0]?.label}</SolidPlate>
        )}
        {onSelectedChange ? (
          <button type="button" onClick={() => setConfiguring((value) => !value)} aria-expanded={configuring} aria-label="选择集合内容" className={cn("gary-icon-button h-9 w-9 shrink-0 rounded-xl", configuring && "text-primary")}>
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {configuring ? (
        <SolidPlate tone="subtle" className="flex flex-wrap gap-1.5 p-2" role="group" aria-label={`${ariaLabel}内容`}>
          {options.map((option) => {
            const enabled = selected.includes(option.id);
            return <button key={option.id} type="button" aria-pressed={enabled} onClick={() => toggle(option.id)} className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] transition-[background-color,color]", enabled ? "bg-primary/12 text-primary" : "bg-foreground/[.035] text-muted-foreground hover:text-foreground")}><Check className={cn("h-3 w-3", !enabled && "opacity-0")} />{option.pickerLabel ?? option.label}</button>;
          })}
        </SolidPlate>
      ) : null}
    </div>
  );
}
