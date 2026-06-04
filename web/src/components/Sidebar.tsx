"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems } from "@/lib/dashboard-data";
import type { NavItem } from "@/types";

function NavLink({
  item,
  indent,
  active,
}: {
  item: NavItem;
  indent?: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-all group/item group-hover:pl-8",
        indent && "ml-4",
        active
          ? "bg-primary/10 text-primary font-medium shadow-sm"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className={cn("h-5 w-5 flex-shrink-0", active && "text-primary")} />
      <span className="text-sm">{item.label}</span>
    </Link>
  );
}

function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const hasActiveChild = item.children?.some((c) => c.href === pathname);
  const [open, setOpen] = useState(true);
  const Icon = item.icon;
  const parentActive = pathname === item.href;
  return (
    <div>
      <div className="group relative flex items-center">
        <Link
          href={item.href}
          className={cn(
            "flex-1 flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-all group/item group-hover:pl-8",
            parentActive || hasActiveChild
              ? "bg-primary/10 text-primary font-medium shadow-sm"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <Icon
            className={cn(
              "h-5 w-5 flex-shrink-0",
              (parentActive || hasActiveChild) && "text-primary"
            )}
          />
          <span className="text-sm">{item.label}</span>
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 rounded hover:bg-accent/70 transition-colors flex items-center justify-center flex-shrink-0"
          aria-label={open ? "收起" : "展开"}
        >
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      {open && item.children && (
        <div className="mt-1 space-y-1">
          {item.children.map((child) => (
            <div key={child.href} className="group relative">
              <NavLink item={child} indent active={child.href === pathname} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const saved = Number(window.sessionStorage.getItem("msm-sidebar-scroll") || 0);
    window.requestAnimationFrame(() => {
      nav.scrollTop = saved;
    });
  }, [pathname]);

  return (
    <aside
      className={cn(
        "hidden md:block fixed left-0 top-14 md:top-16 z-40 w-56 h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)] border-r border-border bg-sidebar transition-transform duration-300",
        collapsed && "md:-translate-x-full"
      )}
    >
      <div className="flex flex-col h-full">
        <nav
          ref={navRef}
          onScroll={(event) => {
            window.sessionStorage.setItem("msm-sidebar-scroll", String(event.currentTarget.scrollTop));
          }}
          className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1"
        >
          {navItems.map((item) =>
            item.children ? (
              <NavGroup key={item.href} item={item} pathname={pathname} />
            ) : (
              <div key={item.href} className="group relative">
                <NavLink item={item} active={item.href === pathname} />
              </div>
            )
          )}
        </nav>
      </div>
    </aside>
  );
}
