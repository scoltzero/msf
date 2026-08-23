import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Check, GripHorizontal, RotateCcw, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DASHBOARD_MAX_WIDGETS, type DashboardSettings } from "@/lib/dashboard-settings";
import { addDashboardWidget, removeDashboardWidget } from "./layout/dashboardLayout";
import { clampWidgetPickerPosition, type WidgetPickerPosition } from "./layout/widgetPickerPosition";
import { widgetCategoryLabels, widgetRegistry } from "./widgetRegistry";

const PICKER_POSITION_KEY = "msf.dashboard.widget-picker-position";

function loadPickerPosition(): WidgetPickerPosition | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PICKER_POSITION_KEY) ?? "null") as Partial<WidgetPickerPosition> | null;
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Number(parsed.x), y: Number(parsed.y) }
      : null;
  } catch {
    return null;
  }
}

export function DashboardWidgetPicker({ settings, canUndo, onChange, onCommand, onClose }: {
  settings: DashboardSettings;
  canUndo: boolean;
  onChange: (settings: DashboardSettings) => void;
  onCommand: (command: "edit" | "done" | "undo" | "reset") => void;
  onClose: () => void;
}) {
  const atLimit = settings.instances.length >= DASHBOARD_MAX_WIDGETS;
  const dialogRef = useRef<HTMLElement>(null);
  const dragOffsetRef = useRef<WidgetPickerPosition | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const [position, setPosition] = useState<WidgetPickerPosition | null>(() => typeof window === "undefined" ? null : loadPickerPosition());

  const clampPosition = (next: WidgetPickerPosition) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return next;
    return clampWidgetPickerPosition(next, {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelWidth: rect.width,
      panelHeight: rect.height,
    });
  };

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    const media = window.matchMedia("(min-width: 768px)");
    const syncViewport = () => {
      setDesktop(media.matches);
      setPosition((current) => current && media.matches ? clampPosition(current) : current);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || desktop) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement) || !focusable.includes(document.activeElement as HTMLElement)) {
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
    media.addEventListener("change", syncViewport);
    window.addEventListener("resize", syncViewport);
    document.addEventListener("keydown", closeOnEscape);
    syncViewport();
    return () => {
      media.removeEventListener("change", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.removeEventListener("keydown", closeOnEscape);
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [desktop, onClose]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!desktop || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setPosition({ x: rect.left, y: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const offset = dragOffsetRef.current;
    if (!desktop || !offset) return;
    setPosition(clampPosition({ x: event.clientX - offset.x, y: event.clientY - offset.y }));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragOffsetRef.current) return;
    dragOffsetRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPosition((current) => {
      if (current) sessionStorage.setItem(PICKER_POSITION_KEY, JSON.stringify(current));
      return current;
    });
  };

  const desktopPositionStyle: CSSProperties | undefined = desktop && position
    ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
    : undefined;

  return (
    <div className={cn("fixed inset-0 z-[59] bg-black/15", desktop && "pointer-events-none bg-transparent")} onPointerDown={(event) => { if (!desktop && event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={desktop ? undefined : true} aria-labelledby="dashboard-widget-picker-title" style={desktopPositionStyle} className="gary-glass gary-glass--thick pointer-events-auto !absolute inset-x-0 bottom-0 flex max-h-[min(82dvh,720px)] flex-col overflow-hidden rounded-t-[28px] border border-border/60 bg-background/92 text-card-foreground shadow-2xl outline-none md:inset-auto md:bottom-24 md:right-6 md:w-[440px] md:max-h-[calc(100dvh-7.5rem)] md:rounded-[24px]">
        <header onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} className={cn("relative flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-4", desktop && "cursor-grab touch-none select-none active:cursor-grabbing")}>
          <div><h2 id="dashboard-widget-picker-title" className="font-semibold">选择仪表盘组件</h2><p className="mt-0.5 text-xs text-muted-foreground">已选择 {settings.instances.length} / {DASHBOARD_MAX_WIDGETS}<span className="hidden md:inline"> · 卡片可直接拖动和缩放</span></p></div>
          <GripHorizontal className="pointer-events-none absolute left-1/2 top-2 hidden h-3.5 w-5 -translate-x-1/2 text-muted-foreground/45 md:block" aria-hidden="true" />
          <button type="button" onClick={onClose} aria-label="关闭组件面板" className="gary-icon-button h-9 w-9 rounded-xl border-0 bg-transparent shadow-none"><X className="h-4 w-4" /></button>
        </header>
        <div className="scrollbar-hide min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          {(["system", "mosdns", "mihomo"] as const).map((category) => (
            <section key={category} aria-labelledby={`widget-category-${category}`}>
              <h3 id={`widget-category-${category}`} className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{widgetCategoryLabels[category]}</h3>
              <div className="flex flex-wrap gap-2">
                {widgetRegistry.filter((item) => item.category === category).map((definition) => {
                  const selected = settings.instances.filter((instance) => instance.type === definition.type);
                  const isSelected = selected.length > 0;
                  const disabled = atLimit && (!isSelected || definition.allowMultiple);
                  const toggle = () => {
                    if (definition.allowMultiple || !isSelected) {
                      const next = addDashboardWidget(settings, definition.type);
                      if (next) onChange(next);
                    } else {
                      onChange(removeDashboardWidget(settings, selected[0].id));
                    }
                  };
                  return (
                    <button key={definition.type} type="button" onClick={toggle} disabled={disabled} aria-pressed={isSelected} title={disabled ? "最多启用 15 个组件" : definition.description} className={cn("gary-glass-button inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40", isSelected && "text-primary")}>
                      <definition.icon className="h-3.5 w-3.5 shrink-0" /><span>{definition.label}</span>
                      {definition.allowMultiple && selected.length ? <span className="rounded-full bg-primary/12 px-1.5 tabular-nums">{selected.length}</span> : isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
              {category === "mihomo" && settings.instances.filter((item) => item.type === "mihomo-proxy-group").length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {settings.instances.filter((item) => item.type === "mihomo-proxy-group").map((instance, index) => <button type="button" key={instance.id} onClick={() => onChange(removeDashboardWidget(settings, instance.id))} className="inline-flex items-center gap-1 rounded-full bg-muted/65 px-2 py-1 text-[10px] text-muted-foreground" title="移除此实例">策略组 {index + 1}<X className="h-3 w-3" /></button>)}
                </div>
              ) : null}
            </section>
          ))}
          {atLimit ? <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">最多启用 15 个组件，取消任意组件后可继续添加。</p> : null}
        </div>
        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-border/50 px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <button type="button" disabled={!canUndo} onClick={() => onCommand("undo")} className="gary-glass-button gap-1.5 rounded-xl px-2 py-2 text-xs disabled:opacity-40"><Undo2 className="h-3.5 w-3.5" />撤销调整</button>
          <button type="button" onClick={() => onCommand("reset")} className="gary-glass-button gap-1.5 rounded-xl px-2 py-2 text-xs"><RotateCcw className="h-3.5 w-3.5" />默认布局</button>
        </footer>
      </section>
    </div>
  );
}
