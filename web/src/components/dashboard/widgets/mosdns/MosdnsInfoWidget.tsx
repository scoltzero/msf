"use client";

import { useState } from "react";
import { DashboardCollectionTabs } from "../../DashboardCollectionTabs";
import { useMosdnsDashboardData } from "../../data";
import { normalizeMosdnsInfo, type MosdnsInfoPage, type MosdnsWidgetSize } from "./model";

export const MOSDNS_INFO_OPTIONS = [
  { id: "split", label: "分流", pickerLabel: "分流统计" },
  { id: "domains", label: "域名", pickerLabel: "域名排行" },
  { id: "slowest", label: "最慢", pickerLabel: "最慢查询" },
  { id: "clients", label: "客户端", pickerLabel: "客户端排行" },
] as const;

export function MosdnsInfoWidget({ activePage, onActivePageChange, pages = ["split", "domains", "slowest", "clients"], onPagesChange, showNavigation = true, size = "m" }: {
  activePage?: MosdnsInfoPage;
  onActivePageChange?: (page: MosdnsInfoPage) => void;
  pages?: MosdnsInfoPage[];
  onPagesChange?: (pages: MosdnsInfoPage[]) => void;
  showNavigation?: boolean;
  size?: MosdnsWidgetSize;
}) {
  const { overview, queryEntries } = useMosdnsDashboardData(["overview", "query"]);
  const [internal, setInternal] = useState<MosdnsInfoPage>(pages[0] ?? "split");
  const selectedPages: MosdnsInfoPage[] = pages.length ? pages : ["split"];
  const requested = activePage ?? internal;
  const page = selectedPages.includes(requested) ? requested : selectedPages[0];
  const setPage = (next: MosdnsInfoPage) => { if (activePage === undefined) setInternal(next); onActivePageChange?.(next); };
  const data = normalizeMosdnsInfo(overview, queryEntries);
  const limit = size === "l" ? 18 : size === "m" ? 12 : 8;
  const rows = data[page].slice(0, limit);
  return <div className="flex h-full min-h-0 flex-col gap-3">
    {showNavigation && (selectedPages.length > 1 || onPagesChange) ? <DashboardCollectionTabs options={MOSDNS_INFO_OPTIONS} selected={selectedPages} active={page} onSelectedChange={onPagesChange} onActiveChange={setPage} ariaLabel="MosDNS 信息页面" /> : null}
    <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-foreground/[.025]">{rows.length ? rows.map((row, index) => <div key={`${row.name}-${index}`} className="border-b border-border/35 px-3 py-2 last:border-0"><div className="flex items-center gap-2 text-xs"><span className="w-5 text-center text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span><b className={("danger" in row && row.danger) ? "text-red-500" : "text-muted-foreground"}>{row.value}</b></div><div className="ml-7 mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.percent)}%` }} /></div></div>) : <div className="grid h-full min-h-28 place-items-center text-xs text-muted-foreground">暂无数据</div>}</div>
    <p className="text-[10px] text-muted-foreground">共 {data.total.toLocaleString()} 次查询{data[page].length > rows.length ? ` · 显示前 ${rows.length} 项` : ""}</p>
  </div>;
}
