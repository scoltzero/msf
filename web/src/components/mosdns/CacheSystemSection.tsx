"use client";

import { useMemo, useState } from "react";
import { Copy, Database, ExternalLink, Search, X } from "lucide-react";
import type {
  CacheDomainRow,
  CacheSystemData,
  CacheStats,
  CacheStrategy,
  ScheduledTask,
  TaskStatus,
} from "@/lib/mosdns-system-data";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { cn } from "@/lib/utils";

type CacheStatKey = Exclude<keyof CacheStats, "totalDomains">;

/* ─── Switch toggle with visible border ─── */
function SwitchToggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-emerald-500" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/* ─── Cache stat cards ─── */
const statCards: { key: CacheStatKey; label: string; icon: string }[] = [
  { key: "realIp", label: "RealIP", icon: "📦" },
  { key: "fakeIp", label: "FakeIP", icon: "🎭" },
  { key: "noV4", label: "无 V4", icon: "🚫" },
  { key: "noV6", label: "无 V6", icon: "🔮" },
];

function CacheStatCards({ stats, onOpen }: { stats: CacheStats; onOpen: (key: CacheStatKey) => void }) {
  return (
    <div>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        {statCards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onOpen(card.key)}
            className="gary-solid-plate gary-solid-plate--subtle cursor-pointer rounded-xl p-3 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
              <span>{card.icon}</span>
              <span>{card.label}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </div>
            <div className="text-xl font-bold tabular-nums text-foreground">{stats[card.key]}</div>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground text-center">
        总计: {stats.totalDomains.toLocaleString()} 个域名
      </p>
    </div>
  );
}

function normalizeDomainForOpen(value: string) {
  return value.replace(/^\d{4}[-/]\d{2}[-/]\d{2}\s+/, "").replace(/^\*\./, "").trim();
}

function CacheDomainModal({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: CacheDomainRow[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.id} ${row.date || ""} ${row.domain} ${row.source || ""}`.toLowerCase().includes(q));
  }, [query, rows]);

  const copyDomain = async (domain: string) => {
    try {
      await navigator.clipboard.writeText(normalizeDomainForOpen(domain));
    } catch {
      window.prompt("复制域名", normalizeDomainForOpen(domain));
    }
  };

  const openDomain = (domain: string) => {
    const clean = normalizeDomainForOpen(domain);
    if (!clean) return;
    window.open(`https://${clean}`, "_blank", "noopener,noreferrer");
  };

  return (
    <ModalViewport onClose={onClose}>
      <GlassSurface material="thick" role="dialog" aria-modal="true" className="relative flex h-[min(78dvh,780px)] w-full max-w-[680px] flex-col rounded-2xl text-card-foreground">
        <div className="flex items-center justify-between border-b border-border/25 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Database className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold">{title} 域名列表</h3>
              <p className="text-xs text-muted-foreground">共 {rows.length.toLocaleString()} 个域名</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭域名列表"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border/25 px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入关键词搜索域名..."
              className="gary-field h-10 w-full pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-[72px_1fr_80px] bg-foreground/[0.035] px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[96px_1fr_96px]">
          <span>ID</span>
          <span>域名</span>
          <span className="text-right">操作</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredRows.map((row, index) => {
            const displayDomain = row.date ? `${row.date} ${row.domain}` : row.domain;
            return (
              <div
                key={`${row.id || index}:${row.domain}`}
                className="grid grid-cols-[72px_1fr_80px] items-center border-b border-border/20 px-4 py-3 text-sm last:border-0 hover:bg-foreground/[0.025] sm:grid-cols-[96px_1fr_96px]"
              >
                <span className="font-mono text-xs text-muted-foreground">{row.id || String(index + 1).padStart(10, "0")}</span>
                <span className="min-w-0 truncate font-mono text-foreground" title={displayDomain}>
                  {displayDomain}
                </span>
                <span className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`复制 ${row.domain}`}
                    onClick={() => void copyDomain(row.domain)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`打开 ${row.domain}`}
                    onClick={() => openDomain(row.domain)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </span>
              </div>
            );
          })}
          {filteredRows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无匹配域名</div>
          )}
        </div>

        <div className="flex justify-end border-t border-border/25 px-4 py-3">
          <GlassButton
            variant="primary"
            type="button"
            onClick={onClose}
            className="text-sm"
          >
            关闭
          </GlassButton>
        </div>
      </GlassSurface>
    </ModalViewport>
  );
}

function toDateTimeLocal(value: string) {
  if (!value || value === "-") return "";
  const cleaned = value.replace(" ", "T");
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return `${match[1]}T${match[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string) {
  return value ? value.replace("T", " ") : "-";
}

/* ─── Cache strategy (vertical layout: label on top) ─── */
function CacheStrategyPanel({
  strategy,
  onToggleCache1,
  onToggleCache2,
}: {
  strategy: CacheStrategy;
  onToggleCache1: () => void;
  onToggleCache2: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
        <span>⚙️</span> 缓存策略
      </div>
      <SolidPlate tone="regular" className="flex flex-1 flex-col justify-between space-y-2 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.03] p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              过期缓存1
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">国内/国外缓存(兼容/安全)</p>
          </div>
          <SwitchToggle checked={strategy.expiredCache1} onToggle={onToggleCache1} />
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.03] p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              过期缓存2
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">启用全部缓存(兼容/安全)与 fakeip</p>
          </div>
          <SwitchToggle checked={strategy.expiredCache2} onToggle={onToggleCache2} />
        </div>
      </SolidPlate>
    </div>
  );
}

/* ─── Scheduled task (vertical layout) ─── */
function ScheduledTaskPanel({
  task,
  onChangeTask,
  onSaveTask,
}: {
  task: ScheduledTask;
  onChangeTask: (t: ScheduledTask) => void;
  onSaveTask?: () => void;
}) {
  const changeInterval = (intervalMinutes: number) => {
    const minutes = Math.max(1, Number.isFinite(intervalMinutes) ? Math.round(intervalMinutes) : 1);
    onChangeTask({ ...task, intervalMinutes: minutes, refreshDays: Math.max(1, Math.round(minutes / 1440)) });
  };
  const changeRefreshDays = (refreshDays: number) => {
    const days = Math.max(1, Number.isFinite(refreshDays) ? Math.round(refreshDays) : 1);
    onChangeTask({ ...task, refreshDays: days, intervalMinutes: days * 1440 });
  };

  return (
    <div className="flex flex-col">
      <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
        <span>⏰</span> 定时任务
      </div>
      <SolidPlate tone="regular" className="flex-1 space-y-2 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">启用定时任务</span>
          <SwitchToggle
            checked={task.enabled}
            onToggle={() => onChangeTask({ ...task, enabled: !task.enabled })}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">首次执行时间</label>
          <input
            type="datetime-local"
            value={toDateTimeLocal(task.firstRunTime)}
            onChange={(e) => onChangeTask({ ...task, firstRunTime: fromDateTimeLocal(e.target.value) })}
            className="gary-field h-9 w-full px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">间隔 (分钟)</label>
          <input
            type="number"
            value={task.intervalMinutes}
            min={1}
            onChange={(e) => changeInterval(Number(e.target.value))}
            className="gary-field h-9 w-full px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">域名刷新天数</label>
          <input
            type="number"
            value={task.refreshDays}
            min={1}
            onChange={(e) => changeRefreshDays(Number(e.target.value))}
            className="gary-field h-9 w-full px-3 text-sm"
          />
        </div>
        <GlassButton
          variant="primary"
          onClick={onSaveTask}
          className="w-full text-xs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          保存配置
        </GlassButton>
      </SolidPlate>
    </div>
  );
}

/* ─── Task status (vertical layout) ─── */
function TaskStatusPanel({ status }: { status: TaskStatus }) {
  return (
    <div className="flex flex-col">
      <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
        <span>📈</span> 任务状态
      </div>
      <SolidPlate tone="regular" className="flex-1 space-y-2 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">当前状态</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
            {status.currentStatus}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">上次运行</span>
          <div className="text-sm text-foreground mt-0.5">{status.lastRunTime}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {status.lastRunRelative} <span className="mx-1">•</span> 耗时 {status.lastRunDuration}
          </div>
        </div>
        <div className="border-t border-border/50 pt-2">
          <span className="text-xs text-muted-foreground">执行记录</span>
          <div className="mt-1 max-h-20 space-y-1 overflow-y-auto pr-1">
            {(status.records || []).length > 0 ? (
              (status.records || []).slice(-4).reverse().map((record, index) => (
                <div key={`${record}:${index}`} className="truncate rounded-lg bg-foreground/[0.035] px-2 py-1 text-xs text-foreground" title={record}>
                  {record}
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground">暂无记录</div>
            )}
          </div>
        </div>
      </SolidPlate>
    </div>
  );
}

/* ─── Operations bar ─── */
function OperationsBar({
  onHotReload,
  onSaveRules,
  onClearDNSCache,
  onClearGeneratedRules,
  disabled,
}: {
  onHotReload: () => void;
  onSaveRules: () => void;
  onClearDNSCache: () => void;
  onClearGeneratedRules: () => void;
  disabled?: boolean;
}) {
  return (
    <SolidPlate tone="subtle" className="rounded-xl p-4">
      <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
        <span>🔧</span> 操作
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <GlassButton
            variant="primary"
            onClick={onHotReload}
            disabled={disabled}
            className="text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            开始热更新
          </GlassButton>
          <GlassButton
            onClick={onSaveRules}
            disabled={disabled}
            className="text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
            </svg>
            保存规则
          </GlassButton>
          <GlassButton
            onClick={onClearDNSCache}
            disabled={disabled}
            className="text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            清空 DNS 缓存
          </GlassButton>
          <GlassButton
            variant="danger"
            onClick={onClearGeneratedRules}
            disabled={disabled}
            className="text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            清空生成规则
          </GlassButton>
        </div>
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-foreground/[0.03] p-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" /><path d="M12 8h.01" />
          </svg>
          <p className="text-xs leading-relaxed text-muted-foreground">
            提示：清空 DNS 缓存只清理 MosDNS 运行时解析缓存；清空生成规则会清空自动生成的 FakeIP、RealIP 和高频域名文件。两项操作都不会删除订阅、配置或 Mihomo Fake-IP 数据库。
          </p>
        </div>
      </div>
    </SolidPlate>
  );
}

/* ─── Main cache system section ─── */
interface CacheSystemSectionProps {
  data: CacheSystemData;
  onToggleCache1: () => void;
  onToggleCache2: () => void;
  onChangeTask: (t: ScheduledTask) => void;
  onHotReload: () => void;
  onSaveRules: () => void;
  onClearDNSCache: () => void;
  onClearGeneratedRules: () => void;
  actionDisabled?: boolean;
  onSaveTask?: () => void;
  cacheDomains?: Partial<Record<CacheStatKey, CacheDomainRow[]>>;
}

export function CacheSystemSection({
  data,
  onToggleCache1,
  onToggleCache2,
  onChangeTask,
  onHotReload,
  onSaveRules,
  onClearDNSCache,
  onClearGeneratedRules,
  actionDisabled,
  onSaveTask,
  cacheDomains = {},
}: CacheSystemSectionProps) {
  const [activeCache, setActiveCache] = useState<CacheStatKey | null>(null);
  const activeCard = statCards.find((card) => card.key === activeCache);
  const activeRows = activeCache ? cacheDomains[activeCache] || [] : [];

  return (
    <GlassSurface material="thick" className="rounded-2xl">
      {/* Header */}
      <div className="flex flex-col space-y-1.5 p-4 pb-2">
        <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
          <span className="gary-solid-plate gary-solid-plate--subtle flex h-8 w-8 items-center justify-center rounded-lg text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </span>
          缓存系统
        </h3>
        <p className="text-xs text-muted-foreground">管理 DNS 解析结果的缓存</p>
      </div>

      {/* Body */}
      <div className="space-y-4 p-4 pt-1">
        {/* Stats block — vertical: label on top */}
        <div>
          <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            <span>📊</span> 缓存统计
          </div>
          <CacheStatCards stats={data.stats} onOpen={setActiveCache} />
        </div>

        {/* Strategy / Task / Status — 3-col grid, each column is vertical */}
        <div className="grid gap-3 lg:grid-cols-3">
          <CacheStrategyPanel
            strategy={data.strategy}
            onToggleCache1={onToggleCache1}
            onToggleCache2={onToggleCache2}
          />
          <ScheduledTaskPanel task={data.scheduledTask} onChangeTask={onChangeTask} onSaveTask={onSaveTask} />
          <TaskStatusPanel status={data.taskStatus} />
        </div>

        {/* Operations */}
        <OperationsBar
          onHotReload={onHotReload}
          onSaveRules={onSaveRules}
          onClearDNSCache={onClearDNSCache}
          onClearGeneratedRules={onClearGeneratedRules}
          disabled={actionDisabled}
        />
      </div>
      {activeCache && activeCard && (
        <CacheDomainModal title={activeCard.label} rows={activeRows} onClose={() => setActiveCache(null)} />
      )}
    </GlassSurface>
  );
}
