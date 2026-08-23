"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Network, RefreshCw, ShieldAlert, X, XCircle } from "lucide-react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

type CheckStatus = "passed" | "warning" | "blocked" | "skipped" | "not_applicable";

interface DiagnosticCheck {
  key: string;
  module: string;
  module_name: string;
  name: string;
  status: CheckStatus;
  message: string;
  expected?: string;
  actual?: string;
  evidence?: string;
  blocking?: boolean;
}

interface DiagnosticTopology {
  mode?: string;
  proxy_core?: string;
  mosdns_enabled?: boolean;
  interface?: string;
  ipv6_enabled?: boolean;
}

interface DiagnosticResult {
  success: boolean;
  overall_status: "ready" | "blocked" | "warning" | "cancelled";
  conclusion: string;
  scope_note: string;
  topology?: DiagnosticTopology;
  checks: DiagnosticCheck[];
}

const statusMeta: Record<CheckStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  passed: { label: "通过", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  warning: { label: "风险", icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  blocked: { label: "阻断", icon: XCircle, className: "text-red-600 dark:text-red-400" },
  skipped: { label: "未继续", icon: ShieldAlert, className: "text-muted-foreground" },
  not_applicable: { label: "不适用", icon: ShieldAlert, className: "text-muted-foreground" },
};

function eventResult(value: unknown): DiagnosticResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const result = (record.result && typeof record.result === "object" ? record.result : record) as Record<string, unknown>;
  if (!Array.isArray(result.checks)) return null;
  return result as unknown as DiagnosticResult;
}

export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const abortRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(true);
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setChecks([]);
    setResult(null);
    setError("");
    try {
      const token = getToken();
      const response = await fetch("/api/v1/system/diagnostics/run", {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`诊断请求失败 (${response.status})`);
      if (!response.body) throw new Error("诊断响应不支持流式读取");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type?: string; check?: DiagnosticCheck; result?: DiagnosticResult };
          if (event.type === "check_completed" && event.check) setChecks((current) => [...current, event.check!]);
          const final = event.type === "run_completed" ? eventResult(event) : null;
          if (final) {
            setResult(final);
            setChecks(final.checks || []);
          }
        }
        if (done) break;
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "诊断执行失败");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => abortRef.current?.abort();
  }, [run]);

  const close = () => {
    abortRef.current?.abort();
    setChecks([]);
    setResult(null);
    onClose();
  };

  const modules = useMemo(() => {
    const grouped = new Map<string, { name: string; checks: DiagnosticCheck[] }>();
    checks.forEach((check) => {
      const current = grouped.get(check.module) || { name: check.module_name || check.module, checks: [] };
      current.checks.push(check);
      grouped.set(check.module, current);
    });
    return [...grouped.entries()];
  }, [checks]);

  const counts = useMemo(() => ({
    passed: checks.filter((item) => item.status === "passed").length,
    warning: checks.filter((item) => item.status === "warning").length,
    blocked: checks.filter((item) => item.status === "blocked").length,
  }), [checks]);

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `msf-local-loop-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const headline = running ? "正在验证本机回路" : error ? "诊断未能完成" : result?.conclusion || "本机回路检查完成";

  return (
    <ModalViewport onClose={close}>
      <GlassSurface role="dialog" aria-modal="true" aria-labelledby="local-loop-diagnostics-title" material="thick" className="flex max-h-[88dvh] w-full max-w-[780px] flex-col overflow-hidden rounded-[24px]">
        <header className="flex items-center gap-3 border-b border-border/50 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-primary/10 text-primary"><Network className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="local-loop-diagnostics-title" className="text-base font-semibold text-foreground">本机网络回路诊断</h2>
            <p className="text-xs text-muted-foreground">只验证 MSF 所在主机，不检查其他局域网设备或公网质量</p>
          </div>
          <button type="button" onClick={close} className="gary-icon-button h-9 w-9 rounded-[12px] text-muted-foreground" aria-label="关闭诊断"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <SolidPlate tone="strong" className="rounded-[19.2px] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {running ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : counts.blocked ? <XCircle className="h-4 w-4 text-red-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {headline}
                </div>
                {result?.topology ? <p className="mt-1 text-xs text-muted-foreground">{result.topology.mode || "-"} · {result.topology.proxy_core || "无代理核心"} · {result.topology.interface || "未指定网卡"}</p> : null}
              </div>
              <div className="flex gap-3 text-xs tabular-nums text-muted-foreground">
                <span>通过 {counts.passed}</span><span>风险 {counts.warning}</span><span>阻断 {counts.blocked}</span>
              </div>
            </div>
            {running ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full w-1/2 animate-pulse rounded-full bg-primary" /></div> : null}
          </SolidPlate>

          {error ? <SolidPlate tone="strong" className="rounded-[16px] p-4 text-sm text-red-600 dark:text-red-400">{error}</SolidPlate> : null}

          {modules.map(([id, group]) => (
            <section key={id} className="space-y-2">
              <div className="flex items-center justify-between px-1"><h3 className="text-sm font-semibold text-foreground">{group.name}</h3><span className="text-xs text-muted-foreground">{group.checks.length} 项</span></div>
              <div className="space-y-2">
                {group.checks.map((check) => {
                  const meta = statusMeta[check.status] || statusMeta.warning;
                  const Icon = meta.icon;
                  return <SolidPlate key={check.key} tone="regular" className="rounded-[16px] p-3.5">
                    <div className="flex items-start gap-3">
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-foreground">{check.name}</span><span className={cn("text-xs font-medium", meta.className)}>{meta.label}</span></div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.message}</p>
                        {(check.expected || check.actual || check.evidence) ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">查看证据</summary><div className="mt-2 space-y-1 rounded-[12px] bg-background/35 p-3 font-mono text-[11px] leading-5 text-muted-foreground">{check.expected ? <div>预期：{check.expected}</div> : null}{check.actual ? <div>实际：{check.actual}</div> : null}{check.evidence ? <div className="whitespace-pre-wrap break-all">证据：{check.evidence}</div> : null}</div></details> : null}
                      </div>
                    </div>
                  </SolidPlate>;
                })}
              </div>
            </section>
          ))}

          {!running && result?.scope_note ? <p className="px-1 text-xs leading-5 text-muted-foreground">{result.scope_note}</p> : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border/50 px-4 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={download} disabled={!result || running} className="gary-glass-button inline-flex h-9 items-center justify-center gap-2 rounded-[12px] px-4 text-sm disabled:opacity-40"><Download className="h-4 w-4" />下载本次报告</button>
          <button type="button" onClick={() => void run()} disabled={running} className="gary-glass-button inline-flex h-9 items-center justify-center gap-2 rounded-[12px] px-4 text-sm disabled:opacity-40"><RefreshCw className={cn("h-4 w-4", running && "animate-spin")} />重新检查</button>
        </footer>
      </GlassSurface>
    </ModalViewport>
  );
}
