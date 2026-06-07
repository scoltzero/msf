"use client";

import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { Fab } from "@/components/Fab";
import { cn } from "@/lib/utils";

/** Shared authenticated layout: fixed header + sidebar, mobile bottom nav, FAB. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader sidebarCollapsed={collapsed} onToggleSidebar={() => setCollapsed((v) => !v)} />
      <Sidebar collapsed={collapsed} />
      <main
        className={cn(
          "pt-14 md:pt-16 pb-20 md:pb-0 transition-all duration-300 min-h-screen",
          collapsed ? "md:pl-20" : "md:pl-56"
        )}
      >
        <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-4 md:py-6">
          {children}
        </div>
      </main>
      <MobileNav />
      <Fab />
    </div>
  );
}
