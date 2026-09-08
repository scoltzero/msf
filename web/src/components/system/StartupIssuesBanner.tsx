"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Copy, Download, ExternalLink, Loader2, RefreshCw, Wrench, X } from "lucide-react";
import { api, apiData } from "@/lib/api";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { cn } from "@/lib/utils";

export interface StartupFixStep {
  title: string;
  detail: string;
  command?: string;
  download_url?: string;
  target_path?: string;
}

export interface StartupIssue {
  code: string;
  title: string;
  message: string;
  detected_at: string;
  fix_steps: StartupFixStep[];
}

/**
 * Startup problems no longer kill the panel (the backend degrades instead of
 * fatal-ing), so they surface here: a persistent banner plus step-by-step
 * repair guidance — including the manual-download path for when the proxy
 * itself is down and the panel cannot fetch anything.
 */
export function StartupIssuesBanner() {
  const [issues, setIssues] = useState<StartupIssue[] | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const payload = await api("/api/v1/system/startup-issues");
      const data = apiData<{ issues?: StartupIssue[] }>(payload, {});
      setIssues(Array.isArray(data?.issues) ? data.issues : []);
    } catch {
      // The banner must never break the page; a failed probe just hides it.
      setIssues(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (!issues?.length) return null;

  return (
    <>
      <div
        role="alert"
        className="mx-auto mb-4 w-full max-w-3xl rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 shadow-sm backdrop-blur dark:text-red-300"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-semibold">代理服务启动受阻（{issues.length} 个问题）</span>
          <span className="min-w-0 flex-1 truncate text-xs opacity-80">{issues[0]?.title}</span>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
          >
            <Wrench className="h-3.5 w-3.5" />
            查看修复步骤
          </button>
        </div>
      </div>
      {detailsOpen ? <StartupIssuesDialog issues={issues} onClose={() => setDetailsOpen(false)} onRefresh={() => void refresh()} /> : null}
    </>
  );
}

function StartupIssuesDialog({ issues, onClose, onRefresh }: { issues: StartupIssue[]; onClose: () => void; onRefresh: () => void }) {
  const [checking, setChecking] = useState(false);
  return (
    <ModalViewport onClose={onClose}>
      <GlassSurface
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-issues-title"
        material="thick"
        className="flex max-h-[88dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px]"
      >
        <header className="flex items-center gap-3 border-b border-border/50 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-red-500/15 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="startup-issues-title" className="text-base font-semibold text-foreground">
              启动问题与修复指引
            </h2>
            <p className="text-xs text-muted-foreground">面板保持可用；mihomo 可能未运行。按步骤修复后点击「重新检测」。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setChecking(true);
              onRefresh();
              window.setTimeout(() => setChecking(false), 800);
            }}
            className="gary-icon-button h-9 w-9 rounded-[12px] text-muted-foreground"
            aria-label="重新检测"
            title="重新检测"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} className="gary-icon-button h-9 w-9 rounded-[12px] text-muted-foreground" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {issues.map((issue) => (
            <article key={issue.code} className="rounded-2xl border border-border/60 bg-background/40 p-4">
              <h3 className="text-sm font-semibold text-foreground">{issue.title}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{issue.message}</p>
              {issue.fix_steps?.length ? (
                <ol className="mt-3 space-y-3">
                  {issue.fix_steps.map((step, index) => (
                    <li key={index} className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground">{step.title}</p>
                                          {step.detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p> : null}
                          {step.download_url ? (
                            <a
                              href={step.download_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 break-all text-xs font-medium text-primary hover:underline"
                            >
                              <Download className="h-3.5 w-3.5 shrink-0" />
                              {step.download_url}
                            </a>
                          ) : null}
                          {step.target_path ? (
                            <p className="mt-1.5 flex items-start gap-1.5 break-all text-xs text-muted-foreground">
                              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              目标路径：<code className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/10">{step.target_path}</code>
                            </p>
                          ) : null}
                          {step.command ? <CommandBox command={step.command} /> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          ))}
        </div>
      </GlassSurface>
    </ModalViewport>
  );
}

function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2">
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/80 p-2.5 pr-10 text-[11px] leading-4 text-emerald-300">{command}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className={cn(
          "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 transition hover:bg-white/20",
          copied && "text-emerald-300"
        )}
        aria-label="复制命令"
        title="复制命令"
      >
        {copied ? <CheckIcon /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3.5 w-3.5">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
