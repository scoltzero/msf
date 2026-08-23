"use client";

import { useState, type ComponentType } from "react";
import { Globe2, Layers3, MapPin, Server } from "lucide-react";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { DashboardCollectionTabs } from "../../DashboardCollectionTabs";
import { useMosdnsDashboardData } from "../../data";
import { normalizeMosdnsCaches, type MosdnsCachePage, type MosdnsWidgetSize } from "./model";

export const MOSDNS_CACHE_OPTIONS = [
  { id: "all", label: "全部", pickerLabel: "全部缓存" },
  { id: "domestic", label: "国内", pickerLabel: "国内缓存" },
  { id: "foreign", label: "国外", pickerLabel: "国外缓存" },
  { id: "node", label: "节点", pickerLabel: "节点缓存" },
] as const;

const pageMeta: Record<MosdnsCachePage, { icon: ComponentType<{ className?: string }>; iconClass: string; surfaceClass: string }> = {
  all: { icon: Layers3, iconClass: "text-violet-500", surfaceClass: "bg-violet-500/10" },
  domestic: { icon: MapPin, iconClass: "text-blue-500", surfaceClass: "bg-blue-500/10" },
  foreign: { icon: Globe2, iconClass: "text-orange-500", surfaceClass: "bg-orange-500/10" },
  node: { icon: Server, iconClass: "text-emerald-500", surfaceClass: "bg-emerald-500/10" },
};

export function MosdnsCacheStatsWidget({ activePage, onActivePageChange, pages = ["all", "domestic", "foreign", "node"], onPagesChange, showNavigation = true, size = "s" }: {
  activePage?: MosdnsCachePage;
  onActivePageChange?: (page: MosdnsCachePage) => void;
  pages?: MosdnsCachePage[];
  onPagesChange?: (pages: MosdnsCachePage[]) => void;
  showNavigation?: boolean;
  size?: MosdnsWidgetSize;
}) {
  const { overview } = useMosdnsDashboardData(["overview"]);
  const [internal, setInternal] = useState<MosdnsCachePage>(pages[0] ?? "all");
  const selectedPages: MosdnsCachePage[] = pages.length ? pages : ["all"];
  const requested = activePage ?? internal;
  const page = selectedPages.includes(requested) ? requested : selectedPages[0];
  const setPage = (next: MosdnsCachePage) => { if (activePage === undefined) setInternal(next); onActivePageChange?.(next); };
  const card = normalizeMosdnsCaches(overview)[page];
  const meta = pageMeta[page];
  const Icon = meta.icon;
  const rows = [
    { label: "请求总数", value: card.total.toLocaleString(), tone: "text-foreground" },
    { label: "缓存命中", value: card.hits.toLocaleString(), tone: "text-foreground" },
    { label: "过期缓存命中", value: card.staleHits.toLocaleString(), tone: "text-foreground" },
    { label: "缓存命中率", value: `${card.hitRate.toFixed(2)}%`, tone: "text-sky-500" },
    { label: "过期命中率", value: `${card.staleRate.toFixed(2)}%`, tone: "text-amber-500" },
    { label: "缓存条目数", value: card.entries.toLocaleString(), tone: "text-foreground" },
  ];
  return <div className="@container flex h-full min-h-0 flex-col gap-3">
    {showNavigation && (selectedPages.length > 1 || onPagesChange) ? <DashboardCollectionTabs options={MOSDNS_CACHE_OPTIONS} selected={selectedPages} active={page} onSelectedChange={onPagesChange} onActiveChange={setPage} ariaLabel="缓存类型" /> : null}
    <div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-xl ${meta.surfaceClass}`}><Icon className={`h-4 w-4 ${meta.iconClass}`} /></span><div><p className="text-sm font-semibold">{card.label}缓存</p><p className="text-[10px] text-muted-foreground">实时命中与缓存分布</p></div></div>
    <div className="grid grid-cols-2 gap-2 @min-[520px]:grid-cols-3">{rows.map((row) => <SolidPlate key={row.label} tone="regular" className="min-w-0 px-3 py-2"><p className="truncate text-[10px] text-muted-foreground">{row.label}</p><p className={`mt-1 truncate text-sm font-semibold tabular-nums ${row.tone}`}>{row.value}</p></SolidPlate>)}</div>
    <div className="mt-auto space-y-2.5"><div><div className="mb-1 flex justify-between text-[10px]"><span className="text-muted-foreground">命中</span><span className="font-medium tabular-nums text-sky-500">{card.hitRate.toFixed(2)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${card.hitRate}%` }} /></div></div><div><div className="mb-1 flex justify-between text-[10px]"><span className="text-muted-foreground">过期命中</span><span className="font-medium tabular-nums text-amber-500">{card.staleRate.toFixed(2)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${card.staleRate}%` }} /></div></div></div>
    {size === "xs" ? <p className="text-[10px] text-muted-foreground"><span className="text-sky-500">●</span> 命中 {card.hits.toLocaleString()}　<span className="text-amber-500">●</span> 过期 {card.staleHits.toLocaleString()}</p> : null}
  </div>;
}
