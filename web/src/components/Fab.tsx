"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LayoutGrid } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  DASHBOARD_LAYOUT_COMMAND_EVENT,
  DASHBOARD_LAYOUT_STATE_EVENT,
  DASHBOARD_SETTINGS_EVENT,
  loadDashboardSettings,
  saveDashboardSettings,
  type DashboardLayoutCommand,
  type DashboardSettings,
} from "@/lib/dashboard-settings";
import { cn } from "@/lib/utils";
import { DashboardWidgetPicker } from "@/components/dashboard/DashboardWidgetPicker";

export function Fab() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [settings, setSettings] = useState<DashboardSettings>(() => loadDashboardSettings());
  const command = useCallback((value: DashboardLayoutCommand) => window.dispatchEvent(new CustomEvent(DASHBOARD_LAYOUT_COMMAND_EVENT, { detail: { command: value } })), []);
  const closePicker = useCallback(() => {
    command("done");
    setOpen(false);
  }, [command]);

  useEffect(() => {
    const sync = () => setSettings(loadDashboardSettings());
    const syncEditing = (event: Event) => {
      const detail = (event as CustomEvent<{ editing?: boolean; canUndo?: boolean }>).detail;
      setEditing(Boolean(detail?.editing));
      setCanUndo(Boolean(detail?.canUndo));
    };
    window.addEventListener(DASHBOARD_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener(DASHBOARD_LAYOUT_STATE_EVENT, syncEditing);
    return () => {
      window.removeEventListener(DASHBOARD_SETTINGS_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(DASHBOARD_LAYOUT_STATE_EVENT, syncEditing);
    };
  }, []);

  if (location.pathname !== "/") return null;

  const update = (next: DashboardSettings) => {
    setSettings(next);
    saveDashboardSettings(next);
  };
  const handleFabClick = () => {
    if (open || editing) {
      closePicker();
      return;
    }
    command("edit");
    setOpen(true);
  };

  return (
    <>
      {open ? <DashboardWidgetPicker settings={settings} canUndo={canUndo} onChange={update} onCommand={command} onClose={closePicker} /> : null}
      <button type="button" onClick={handleFabClick} aria-label={editing ? "完成仪表盘编辑" : "打开仪表盘组件"} aria-expanded={open} className={cn("fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 z-[60] grid h-12 w-12 place-items-center rounded-full border border-sky-300/70 bg-sky-200/90 text-sky-800 shadow-[0_12px_32px_rgb(56_189_248_/_0.28)] backdrop-blur-xl transition hover:bg-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 md:bottom-6 md:right-6 md:h-[52px] md:w-[52px]", editing && "bg-sky-400 text-white", open && "scale-105")} title={editing ? "完成仪表盘编辑" : "仪表盘组件"}>
        {editing ? <Check className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
      </button>
    </>
  );
}
