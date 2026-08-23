"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { mobileNavItems } from "@/lib/dashboard-data";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";

export function MobileNav() {
  const pathname = usePathname();
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden">
      <GlassSurface material="ultrathin" className="rounded-[24px]">
        <div className="flex p-1.5">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "gary-nav-row flex min-h-11 flex-1 flex-col items-center justify-center rounded-[16px] py-2.5",
                  active
                    ? "gary-nav-row--active"
                    : "text-muted-foreground"
                )}
                aria-label={item.label}
              >
                <Icon className="h-5 w-5" />
              </Link>
            );
          })}
        </div>
      </GlassSurface>
    </div>
  );
}
