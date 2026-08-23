"use client";

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { Fab } from "@/components/Fab";
import { GlassFilterDefs } from "@/components/liquid-glass/GlassFilterDefs";
import { SceneBackdrop } from "@/components/liquid-glass/SceneBackdrop";
import { cn } from "@/lib/utils";
import { DiagnosticsDialog } from "@/components/system/DiagnosticsDialog";

interface AppShellProps {
  children: React.ReactNode;
  fillViewport?: boolean;
  contentUnderHeader?: boolean;
  disablePageMotion?: boolean;
}

/** Shared authenticated layout: fixed header + sidebar, mobile bottom nav, FAB. */
export function AppShell({
  children,
  fillViewport = false,
  contentUnderHeader = false,
  disablePageMotion = false,
}: AppShellProps) {
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("dialog") !== "diagnostics") return;
    setDiagnosticsOpen(true);
    params.delete("dialog");
    const search = params.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ""}${location.hash}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  return (
    <div className={cn("gary-app-shell", sidebarHidden && "gary-app-shell--sidebar-hidden")}>
      <SceneBackdrop />
      <GlassFilterDefs />
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[80] -translate-y-24 rounded-xl bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg transition-transform focus:translate-y-0"
      >
        跳到主内容
      </a>
      <AppHeader sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden((value) => !value)} onOpenDiagnostics={() => setDiagnosticsOpen(true)} />
      <Sidebar hidden={sidebarHidden} />
      <main
        id="main-content"
        className={cn(
          "transition-[padding-left] duration-300 ease-in-out",
          fillViewport
            ? contentUnderHeader
              ? "min-h-dvh scroll-pb-[var(--gary-mobile-nav-clearance)] pb-[var(--gary-mobile-nav-clearance)] pt-0 md:scroll-pb-0 md:pb-0"
              : "h-dvh overflow-hidden scroll-pb-[var(--gary-mobile-nav-clearance)] pb-[var(--gary-mobile-nav-clearance)] pt-16 md:scroll-pb-0 md:pb-3 md:pt-[85px]"
            : "min-h-screen scroll-pb-[var(--gary-mobile-nav-clearance)] pb-[var(--gary-mobile-nav-clearance)] pt-20 md:scroll-pb-0 md:pb-8 md:pt-[85px]",
          sidebarHidden ? "md:pl-0" : "md:pl-[var(--gary-sidebar-content-offset)]"
        )}
      >
        <div
          className={cn(
            "gary-page-enter w-full px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12",
            disablePageMotion && "gary-page-enter--static",
            fillViewport && !contentUnderHeader
              ? "h-full min-h-0 overflow-hidden"
              : !contentUnderHeader && "py-4 md:pb-6 md:pt-0"
          )}
        >
          {children}
        </div>
      </main>
      <MobileNav />
      <Fab />
      {diagnosticsOpen ? <DiagnosticsDialog onClose={() => setDiagnosticsOpen(false)} /> : null}
    </div>
  );
}
