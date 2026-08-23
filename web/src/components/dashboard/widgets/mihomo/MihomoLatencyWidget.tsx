"use client";

import { useRef, useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { runFaviconRounds, type FaviconSample, type FaviconTarget } from "@/components/mihomo/overview/telemetry";
import type { MihomoWidgetSize } from "./MihomoTrafficWidget";

export const LATENCY_TARGETS: FaviconTarget[] = [
  { id: "baidu", label: "百度", url: "https://apps.bdimg.com/favicon.ico" },
  { id: "google", label: "Google", url: "https://www.google.com/favicon.ico" },
  { id: "github", label: "GitHub", url: "https://github.githubassets.com/favicon.ico" },
  { id: "cloudflare", label: "Cloudflare", url: "https://www.cloudflare.com/favicon.ico" },
];
export const LATENCY_ROUNDS = 10;
export const LATENCY_TARGET_CONCURRENCY = 4;

type FaviconRoundsRunner = (
  targets: FaviconTarget[],
  rounds: number,
  onSample?: (sample: FaviconSample) => void,
) => Promise<FaviconSample[]>;

/** Run sites concurrently while keeping each site's rounds serial and capped. */
export async function runLatencyTargetRounds(
  targets: FaviconTarget[],
  rounds: number,
  onSample?: (sample: FaviconSample) => void,
  concurrency = LATENCY_TARGET_CONCURRENCY,
  runner: FaviconRoundsRunner = runFaviconRounds,
) {
  const samples: FaviconSample[] = [];
  let cursor = 0;
  const workerCount = Math.min(targets.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < targets.length) {
      const target = targets[cursor];
      cursor += 1;
      await runner([target], rounds, (sample) => {
        samples.push(sample);
        onSample?.(sample);
      });
    }
  }));
  return samples;
}

export type LatencyStats = { min: number; avg: number; max: number; successes: number } | null;
export function calculateLatencyStats(samples: FaviconSample[]): LatencyStats {
  const values = samples.filter((sample) => sample.ok && Number.isFinite(sample.elapsedMs)).map((sample) => sample.elapsedMs);
  if (!values.length) return null;
  return { min: Math.min(...values), avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), max: Math.max(...values), successes: values.length };
}

function barColor(value: number) {
  return value < 400 ? "bg-emerald-500" : value < 800 ? "bg-amber-500" : "bg-rose-500";
}

function TargetResult({ target, samples, compact }: { target: FaviconTarget; samples: FaviconSample[]; compact: boolean }) {
  const own = samples.filter((sample) => sample.targetId === target.id);
  const stats = calculateLatencyStats(own);
  const ceiling = Math.max(1, ...own.filter((sample) => sample.ok).map((sample) => sample.elapsedMs));
  return (
    <SolidPlate tone="regular" role="group" aria-label={`${target.label} 延迟结果`} className={cn("flex min-h-0 min-w-0 flex-col", compact ? "p-2" : "p-2.5")}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-semibold" title={target.label}>{target.label}</span>
        <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{own.length}/{LATENCY_ROUNDS}</span>
      </div>
      <div className={cn("mt-1.5 flex items-end gap-0.5", compact ? "h-7" : "h-10")}>
        {Array.from({ length: LATENCY_ROUNDS }, (_, index) => {
          const sample = own[index];
          return <i key={index} title={!sample ? "等待测试" : sample.ok ? `${sample.elapsedMs}ms` : "失败"} className={cn("min-w-0 flex-1 rounded-t-sm transition-[height,background-color] duration-300", !sample ? "bg-foreground/10" : sample.ok ? barColor(sample.elapsedMs) : "bg-rose-500/30")} style={{ height: `${!sample ? 12 : sample.ok ? Math.max(12, sample.elapsedMs / ceiling * 100) : 100}%` }} />;
        })}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-0.5 text-center text-[8px] leading-tight tabular-nums text-muted-foreground">
        <span>低 <b className="block truncate text-[9px] text-foreground">{stats ? `${stats.min}ms` : "--"}</b></span>
        <span>均 <b className="block truncate text-[9px] text-foreground">{stats ? `${stats.avg}ms` : "--"}</b></span>
        <span>高 <b className="block truncate text-[9px] text-foreground">{stats ? `${stats.max}ms` : "--"}</b></span>
      </div>
    </SolidPlate>
  );
}

export type MihomoLatencyWidgetProps = { size?: MihomoWidgetSize };
export function MihomoLatencyWidget({ size = "s" }: MihomoLatencyWidgetProps) {
  const [samples, setSamples] = useState<FaviconSample[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const compact = size === "s";
  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setSamples([]);
    try {
      await runLatencyTargetRounds(LATENCY_TARGETS, LATENCY_ROUNDS, (sample) => setSamples((current) => [...current, sample]));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="truncate text-[10px] text-muted-foreground">4 个站点 · 各 10 轮</p>
        <button type="button" onClick={() => void run()} disabled={running} className="gary-glass-button shrink-0 gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] disabled:cursor-wait disabled:opacity-60">
          <Zap className={cn("h-3.5 w-3.5", running && "animate-pulse")} />
          {running ? `测试中 ${samples.length}/40` : "开始测试"}
        </button>
      </div>
      <div className={cn("grid min-h-0 flex-1 gap-1.5", compact ? "grid-cols-2 grid-rows-2" : "grid-cols-4")}>
        {LATENCY_TARGETS.map((target) => <TargetResult key={target.id} target={target} samples={samples} compact={compact} />)}
      </div>
    </div>
  );
}
