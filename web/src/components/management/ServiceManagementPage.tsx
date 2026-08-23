import type { LucideIcon } from "lucide-react";
import { CircleStop, RefreshCw, Server } from "lucide-react";
import Link from "next/link";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { WorkbenchHeader } from "@/components/layout/WorkbenchHeader";
import { cn } from "@/lib/utils";

export type ManagementTone = "blue" | "orange" | "teal" | "pink" | "cyan" | "green" | "purple";

export interface ManagementModule {
  icon: LucideIcon;
  tone: ManagementTone;
  title: string;
  description: string;
  href: string;
}

export interface ManagementStat {
  icon: LucideIcon;
  tone: ManagementTone;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
}

interface ServiceManagementPageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  version: string;
  running: boolean;
  busy: string;
  info: Array<{ label: string; value: string }>;
  stats: ManagementStat[];
  modules: ManagementModule[];
  onAction: (action: "start" | "stop" | "restart") => void;
}

const toneClasses: Record<ManagementTone, { icon: string; tile: string; line: string }> = {
  blue: { icon: "text-blue-600 dark:text-blue-300", tile: "bg-blue-500/12", line: "bg-blue-500" },
  orange: { icon: "text-orange-600 dark:text-orange-300", tile: "bg-orange-500/12", line: "bg-orange-500" },
  teal: { icon: "text-teal-600 dark:text-teal-300", tile: "bg-teal-500/12", line: "bg-teal-500" },
  pink: { icon: "text-pink-600 dark:text-pink-300", tile: "bg-pink-500/12", line: "bg-pink-500" },
  cyan: { icon: "text-cyan-600 dark:text-cyan-300", tile: "bg-cyan-500/12", line: "bg-cyan-500" },
  green: { icon: "text-emerald-600 dark:text-emerald-300", tile: "bg-emerald-500/12", line: "bg-emerald-500" },
  purple: { icon: "text-violet-600 dark:text-violet-300", tile: "bg-violet-500/12", line: "bg-violet-500" },
};

function IconTile({ icon: Icon, tone, large = false }: { icon: LucideIcon; tone: ManagementTone; large?: boolean }) {
  const color = toneClasses[tone];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[16px] border border-border/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
        color.tile,
        large ? "h-14 w-14" : "h-11 w-11"
      )}
    >
      <Icon className={cn(color.icon, large ? "h-7 w-7" : "h-5 w-5")} />
    </span>
  );
}

export function ServiceManagementPage({
  icon: HeroIcon,
  title,
  description,
  version,
  running,
  busy,
  info,
  stats,
  modules,
  onAction,
}: ServiceManagementPageProps) {
  return (
    <div className="space-y-5 md:space-y-6">
      <WorkbenchHeader
        icon={HeroIcon}
        title={title}
        description={description}
        status={(
          <>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary ring-1 ring-inset ring-primary/20">{version}</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", running ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-emerald-500" : "bg-muted-foreground/55")} />
                {running ? "运行中" : "已停止"}
            </span>
          </>
        )}
        actions={(
          <>
            <GlassButton type="button" variant="secondary" onClick={() => onAction("restart")} disabled={!!busy} className="h-9 px-3 text-xs">
              <RefreshCw className={cn("h-4 w-4", busy === "restart" && "animate-spin")} />
              重启
            </GlassButton>
            <GlassButton type="button" variant={running ? "danger" : "primary"} onClick={() => onAction(running ? "stop" : "start")} disabled={!!busy} className="h-9 px-3 text-xs">
              {running ? <CircleStop className="h-4 w-4" /> : <Server className="h-4 w-4" />}
              {running ? "停止" : "启动"}
            </GlassButton>
          </>
        )}
        summary={(
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {info.map((item) => (
                <SolidPlate key={item.label} tone="strong" className="min-w-0 rounded-[14px] px-3.5 py-3">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground" title={item.value}>{item.value}</div>
                </SolidPlate>
              ))}
          </div>
        )}
      />

      <GlassSurface material="thick" className="rounded-[24px] p-5 md:p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">运行统计</h2>
            <p className="mt-1 text-xs text-muted-foreground">进程资源与实时运行状态</p>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:block">每 3 秒自动刷新</span>
        </div>
        <div className={cn("grid gap-3", stats.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
          {stats.map((stat, index) => {
            const color = toneClasses[stat.tone];
            const progress = stat.progress === undefined ? undefined : Math.max(0, Math.min(stat.progress, 100));
            return (
              <SolidPlate key={stat.label} tone="regular" className={cn("min-w-0 rounded-[16px] p-4", stats.length >= 3 && index === 2 && "sm:col-span-2 lg:col-span-1")}>
                <div className="flex items-center gap-3">
                  <IconTile icon={stat.icon} tone={stat.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="mt-0.5 truncate text-2xl font-bold tabular-nums text-foreground" title={stat.value}>{stat.value}</p>
                  </div>
                </div>
                {progress !== undefined ? (
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted/80">
                    <div className={cn("h-full rounded-full transition-[width] duration-300", color.line)} style={{ width: `${progress}%` }} />
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">{stat.detail || "实时采集"}</p>
                )}
              </SolidPlate>
            );
          })}
        </div>
      </GlassSurface>

      <section className="space-y-4" aria-labelledby="management-modules-title">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h2 id="management-modules-title" className="text-xl font-bold text-foreground">功能模块</h2>
            <p className="mt-1 text-xs text-muted-foreground">进入对应模块继续管理</p>
          </div>
          <span className="text-xs text-muted-foreground">{modules.length} 个可用模块</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Link key={module.href} href={module.href} className="group rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <GlassSurface material="thick" className="h-full rounded-[22px] p-5 transition-[transform,box-shadow,border-color] duration-250 group-hover:-translate-y-1 group-hover:border-primary/30 group-hover:shadow-[var(--gary-contact-shadow),var(--gary-floating-shadow)]">
                  <div className="flex items-start gap-3.5">
                    <IconTile icon={Icon} tone={module.tone} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-foreground transition-colors group-hover:text-primary">{module.title}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{module.description}</p>
                    </div>
                  </div>
                </GlassSurface>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
